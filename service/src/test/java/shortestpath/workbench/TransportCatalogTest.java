package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.testtools.JavalinTest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import shortestpath.pathfinder.PluginResources;
import shortestpath.transport.Transport;

/** The explorer's catalogue: the plugin's own transports, traced to their rows, a view at a time. */
class TransportCatalogTest {
    static final String HEADER = "# Origin\tDestination\tmenuOption menuTarget objectID\tSkills\tQuests\tVarbits\tDuration\tDisplay info\n";
    static TransportCatalog bundled;

    @BeforeAll
    static void load() {
        bundled = TransportCatalog.load(id -> "Item " + id);
    }

    private static String key(Transport transport) {
        return String.join("|", transport.getType().name(), String.valueOf(transport.getOrigin()), String.valueOf(transport.getDestination()),
            Objects.toString(transport.getObjectInfo(), ""), Objects.toString(transport.getDisplayInfo(), ""));
    }

    @Test
    void isTheSetOfTransportsTheRouterUses() {
        Map<String, Integer> router = new HashMap<>(), catalogue = new HashMap<>();
        PluginResources.transports().values().forEach(set -> set.forEach(transport -> router.merge(key(transport), 1, Integer::sum)));
        bundled.entries().forEach(entry -> catalogue.merge(key(entry.transport), 1, Integer::sum));
        assertEquals(router, catalogue);
        assertTrue(bundled.size() > 1000, "the plugin has thousands of transports");
    }

    @Test
    void tracesEveryTransportToTheRowsItCameFrom() {
        for (TransportCatalog.Entry entry : bundled.entries()) {
            switch (entry.construction) {
                case "row":
                case "teleport":
                    assertEquals(1, entry.sources.size(), entry.id + " " + entry.transport);
                    assertEquals("row", entry.sources.get(0).role);
                    break;
                case "paired":
                    assertEquals(List.of("origin", "destination"), entry.sources.stream().map(source -> source.role).collect(Collectors.toList()),
                        entry.id + " " + entry.transport);
                    break;
                default:
                    throw new AssertionError(entry.construction);
            }
            assertEquals(entry.file, entry.sources.get(0).file);
        }
        // Transports that look alike (a teleport with several sets of requirements) each have their own row and id.
        Map<String, List<TransportCatalog.Entry>> alike = bundled.entries().stream().collect(Collectors.groupingBy(entry ->
            entry.file + key(entry.transport)));
        for (List<TransportCatalog.Entry> group : alike.values()) {
            if (group.size() > 1 && group.get(0).construction.equals("teleport")) {
                assertEquals(group.size(), group.stream().map(entry -> entry.sources.get(0).line).distinct().count(), group.get(0).transport.toString());
            }
        }
        assertEquals(bundled.size(), bundled.entries().stream().map(entry -> entry.id).distinct().count());
        // Fairy rings are a network: each ring's origin row paired with every other ring's destination row.
        TransportCatalog.Entry ring = bundled.entries().stream().filter(entry -> entry.transport.getType().name().equals("FAIRY_RING")).findFirst().orElseThrow();
        assertEquals("paired", ring.construction);
        assertEquals("src/main/resources/transports/fairy_rings.tsv", ring.file);
        // Teleports leave from anywhere: no origin is made up for them.
        TransportCatalog.Entry teleport = bundled.entries().stream().filter(entry -> entry.transport.getType().name().equals("TELEPORTATION_ITEM")).findFirst().orElseThrow();
        assertNull(teleport.origin);
        assertEquals("teleport", teleport.construction);
    }

    @Test
    void pairsNetworkRowsAndNotesRemappedDestinations() {
        TransportCatalog catalog = TransportCatalog.build(Map.of(
            "FAIRY_RING", HEADER
                + "100 100 0\t\tConfigure Fairy ring 1\t\t\t\t5\t\n"
                + "200 200 0\t\tConfigure Fairy ring 2\t\t\t\t5\t\n"
                + "\t100 101 0\t\t\t\t\t5\tAAA\n"
                + "\t200 201 0\t\t\t\t\t5\tBBB\n",
            "TRANSPORT", HEADER + "## House\n3000 3000 0\t1900 7060 0\tEnter Portal 9\t\t\t\t\t\n"), id -> "Item " + id);
        List<TransportCatalog.Entry> rings = catalog.entries().stream().filter(entry -> entry.file.endsWith("fairy_rings.tsv")).collect(Collectors.toList());
        // Each ring to the other; never to itself (within the type's radius).
        assertEquals(2, rings.size());
        TransportCatalog.Detail detail = catalog.detail(rings.stream().filter(entry -> entry.origin.x == 100).findFirst().orElseThrow().id);
        assertEquals("paired", detail.construction);
        assertEquals("BBB", detail.displayInfo);
        assertEquals("Configure Fairy ring 1", detail.objectInfo);
        assertEquals(2, detail.sources.get(0).line);
        assertEquals(5, detail.sources.get(1).line);
        // The plugin moves destinations inside a house to its landing tile; the original is kept.
        TransportCatalog.Entry house = catalog.entries().stream().filter(entry -> entry.file.endsWith("transports.tsv")).findFirst().orElseThrow();
        assertEquals("1858 7051 0", house.destination.toString());
        assertEquals("1900 7060 0", house.remappedFrom.toString());
        assertEquals("House", house.sources.get(0).section);
        assertEquals(TransportCatalog.id("TRANSPORT", house.file, house.origin, house.remappedFrom, "Enter Portal 9", "",
            house.sources.get(0).fields.toString()), house.id);
    }

    @Test
    void listsTransportsWithAnEndInTheViewAndCountsThemWhenThereAreTooMany() {
        TransportCatalog catalog = TransportCatalog.build(Map.of("TRANSPORT", HEADER
            + "100 100 0\t110 100 0\tOpen Door 1\t\t\t\t\t\n"
            + "500 500 0\t100 105 0\tClimb Ladder 2\t\t\t\t\t\n"
            + "900 900 0\t910 910 0\tOpen Door 3\t\t\t\t\t\n"
            + "100 100 1\t100 100 0\tClimb-down Ladder 4\t\t\t\t\t\n",
            "TELEPORTATION_ITEM", "# Destination\tmenuOption menuTarget objectID\tItems\tDuration\tDisplay info\n105 102 0\t\t\t4\tSome teleport\n"),
            id -> "Item " + id);
        TransportCatalog.View view = catalog.view(List.of(new TransportCatalog.Box(0, 90, 90, 120, 120)), Set.of(), 100);
        // Door 1 (both ends), the ladder arriving from far away, the plane 1 ladder's foot, and the teleport's landing.
        assertEquals(Set.of("Open Door 1", "Climb Ladder 2", "Climb-down Ladder 4", "Some teleport"),
            view.transports.stream().map(summary -> summary.label).collect(Collectors.toSet()));
        TransportCatalog.Summary teleport = view.transports.stream().filter(summary -> summary.teleport).findFirst().orElseThrow();
        assertNull(teleport.origin);
        assertEquals(Set.of("Some teleport"), catalog.view(List.of(new TransportCatalog.Box(0, 90, 90, 120, 120)), Set.of("TELEPORTATION_ITEM"), 100)
            .transports.stream().map(summary -> summary.label).collect(Collectors.toSet()));
        // Planes are kept apart.
        assertEquals(Set.of("Climb-down Ladder 4"), catalog.view(List.of(new TransportCatalog.Box(1, 90, 90, 120, 120)), Set.of(), 100)
            .transports.stream().map(summary -> summary.label).collect(Collectors.toSet()));
        TransportCatalog.View counted = catalog.view(List.of(new TransportCatalog.Box(0, 0, 0, 1000, 1000)), Set.of(), 2);
        assertEquals(5, counted.total);
        assertTrue(counted.transports.isEmpty());
    }

    @Test
    void joinsNetworkStationsToAHubPerConnectedPart() {
        TransportCatalog catalog = TransportCatalog.build(Map.of(
            // Two lines of canoes that never meet; a station's two tiles are one station.
            "CANOE", HEADER
                + "100 100 0\t200 100 0\tPaddle Canoe 1\t\t\t\t5\tEast\n"
                + "101 101 0\t200 100 0\tPaddle Canoe 1\t\t\t\t5\tEast\n"
                + "200 100 0\t100 100 0\tPaddle Canoe 2\t\t\t\t5\tWest\n"
                + "200 100 0\t300 400 0\tPaddle Canoe 2\t\t\t\t5\t\n"
                + "1000 1000 0\t1100 1000 0\tPaddle Canoe 3\t\t\t\t5\t\n"
                // Underground stations don't pull the hub off the surface.
                + "1100 1000 0\t1100 9000 0\tPaddle Canoe 4\t\t\t\t5\t\n"
                + "1100 9000 0\t1100 1000 0\tPaddle Canoe 5\t\t\t\t5\t\n",
            "TRANSPORT", HEADER + "100 99 0\t100 98 0\tOpen Door 7\t\t\t\t\t\n"), id -> "Item " + id);
        TransportCatalog.View view = catalog.view(List.of(new TransportCatalog.Box(0, 90, 90, 210, 110)), Set.of(), 100);
        assertEquals(1, view.networks.size());
        TransportCatalog.Network first = view.networks.get(0);
        assertEquals("CANOE:0", first.id);
        assertEquals("Canoes", first.name);
        assertEquals(List.of("100 100 0", "200 100 0"), first.stations.stream().map(station -> station.point.toString()).collect(Collectors.toList()));
        // Named by what the canoes arriving there call it.
        assertEquals(List.of("West", "East"), first.stations.stream().map(station -> station.name).collect(Collectors.toList()));
        assertEquals("150 100 0", first.hub.toString());
        assertTrue(view.transports.stream().filter(summary -> summary.type.equals("CANOE")).allMatch(summary -> "CANOE:0".equals(summary.network)));
        assertNull(view.transports.stream().filter(summary -> summary.type.equals("TRANSPORT")).findFirst().orElseThrow().network);
        TransportCatalog.Network second = catalog.view(List.of(new TransportCatalog.Box(0, 990, 990, 1010, 1010)), Set.of(), 100).networks.get(0);
        assertEquals("CANOE:1", second.id);
        assertEquals(3, second.stations.size());
        assertEquals("1050 1000 0", second.hub.toString());
        // Too many to list: no networks either.
        assertTrue(catalog.view(List.of(new TransportCatalog.Box(0, 0, 0, 2000, 2000)), Set.of(), 2).networks.isEmpty());
    }

    @Test
    void namesEveryBundledNetwork() {
        Set<String> types = bundled.entries().stream().filter(entry -> entry.network != null).map(entry -> entry.transport.getType().name())
            .collect(Collectors.toSet());
        assertEquals(TransportCatalog.NETWORK_TYPES, types);
        assertEquals(bundled.networks().stream().map(network -> network.type).collect(Collectors.toSet()), types);
        // A fairy ring is one station, however many tiles it leaves from; every ring is one network.
        assertEquals(1, bundled.entries().stream().filter(entry -> entry.network != null && entry.network.startsWith("FAIRY_RING:"))
            .map(entry -> entry.network).distinct().count());
    }

    @Test
    void staysBoundedOverALargeNetworkZoomedOut() {
        StringBuilder rows = new StringBuilder(HEADER);
        int n = 0;
        for (int x = 1000; x < 4000; x += 9) {
            for (int y = 2000; y < 4000; y += 9) {
                rows.append(x).append(' ').append(y).append(" 0\t").append(x + 3).append(' ').append(y + 2).append(" 0\tOpen Door ").append(n++).append("\t\t\t\t\t\n");
            }
        }
        TransportCatalog catalog = TransportCatalog.build(Map.of("TRANSPORT", rows.toString()), id -> "Item " + id);
        assertTrue(catalog.size() > 70_000);
        long started = System.nanoTime();
        TransportCatalog.View world = catalog.view(List.of(new TransportCatalog.Box(0, 960, 1900, 4100, 4100)), Set.of(), TransportCatalog.VIEW_LIMIT);
        long millis = (System.nanoTime() - started) / 1_000_000;
        assertEquals(catalog.size(), world.total);
        assertTrue(world.transports.isEmpty());
        assertTrue(millis < 2000, millis + " ms");
        TransportCatalog.View close = catalog.view(List.of(new TransportCatalog.Box(0, 2000, 3000, 2040, 3040)), Set.of(), TransportCatalog.VIEW_LIMIT);
        assertFalse(close.transports.isEmpty());
        assertTrue(close.transports.size() <= TransportCatalog.VIEW_LIMIT);
    }

    @Test
    void searchesByObjectIdTileAndText() {
        TransportCatalog.Entry door = bundled.entries().stream().filter(entry -> entry.origin != null && entry.transport.getObjectInfo() != null
            && entry.transport.getObjectInfo().matches(".* \\d+$")).findFirst().orElseThrow();
        String objectId = door.transport.getObjectInfo().replaceAll(".* ", "");
        assertTrue(bundled.search(objectId, Set.of()).stream().anyMatch(summary -> summary.id.equals(door.id)));
        assertTrue(bundled.search(door.origin.x + "," + door.origin.y + "," + door.origin.plane, Set.of()).stream()
            .anyMatch(summary -> summary.id.equals(door.id)));
        assertTrue(bundled.search("fairy ring", Set.of()).size() > 0);
        assertTrue(bundled.search("e", Set.of()).size() <= TransportCatalog.SEARCH_LIMIT);
    }

    @Test
    void servesMetaViewsDetailsAndSearches() {
        Javalin app = Javalin.create();
        Workbench.transportRoutes(app, () -> bundled, new Provenance(new Provenance.Revision("Skretzo/shortest-path", "abc"),
            new Provenance.Revision("osrs-pathfinding/shortest-path-tooling", "def")));
        app.exception(IllegalArgumentException.class, (error, ctx) -> ctx.status(400));
        app.exception(Reviews.NotFound.class, (error, ctx) -> ctx.status(404));
        ObjectMapper mapper = new ObjectMapper();
        TransportCatalog.Entry door = bundled.entries().stream().filter(entry -> entry.origin != null).findFirst().orElseThrow();
        JavalinTest.test(app, (server, client) -> {
            JsonNode meta = mapper.readTree(client.get("/workbench/v1/transports/meta").body().string());
            assertEquals("abc", meta.at("/plugin/rev").asText());
            assertEquals(bundled.size(), meta.get("total").asInt());
            var lumbridge = client.get("/workbench/v1/transports?view=0,3200,3200,3240,3240;1,3200,3200,3240,3240");
            assertEquals(200, lumbridge.code());
            assertNotNull(lumbridge.header("Cache-Control"));
            JsonNode view = mapper.readTree(lumbridge.body().string());
            assertTrue(view.get("total").asInt() > 0);
            JsonNode detail = mapper.readTree(client.get("/workbench/v1/transports/" + door.id).body().string());
            assertEquals(door.id, detail.get("id").asText());
            assertEquals(door.sources.get(0).line, detail.at("/sources/0/line").asInt());
            assertEquals(400, client.get("/workbench/v1/transports?view=0,0,0,9000,9000").code());
            assertEquals(400, client.get("/workbench/v1/transports?view=nope").code());
            assertEquals(404, client.get("/workbench/v1/transports/000000000000").code());
            assertTrue(mapper.readTree(client.get("/workbench/v1/transports/search?q=fairy").body().string()).size() > 0);
        });
    }

    @Test
    void readsTheBundledProvenanceOrSaysItIsUnknown() {
        Provenance provenance = Provenance.bundled();
        assertEquals("Skretzo/shortest-path", provenance.plugin.repository);
        assertTrue(provenance.plugin.rev.matches("[0-9a-f]{40}|unknown"), provenance.plugin.rev);
    }

    @Test
    void parsesViewBoxes() {
        assertEquals(2, Workbench.boxes("0,1,2,3,4;1,-5,6,7,8").size());
        assertThrows(IllegalArgumentException.class, () -> Workbench.boxes("4,0,0,1,1"));
        assertThrows(IllegalArgumentException.class, () -> Workbench.boxes(String.join(";", java.util.Collections.nCopies(30, "0,0,0,1,1"))));
    }
}

package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import shortestpath.WorldPointUtil;
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.PluginResources;
import shortestpath.transport.ResourceLoader;
import shortestpath.transport.TransportType;

class DestinationViolationsTest {
    static final String FILE = "src/main/resources/transports/transports.tsv";
    static final String HEADER = "# Origin\tDestination\tmenuOption menuTarget objectID";

    static List<Map<String, Object>> check(String rows, java.util.function.Predicate<TransportDiff.Point> walkable) {
        var findings = new TransportInvariants.Findings();
        DestinationViolations.collect(TransportInvariants.rows(FILE, HEADER + "\n" + rows), walkable, findings);
        return findings.list;
    }

    @Test void exactOriginsAndWalkableTilesPassButNearbyTilesAndOtherPlanesDoNot() {
        var failures = check("100 100 0\t200 200 0\tWalkable arrival 1\n"
            + "101 100 0\t300 300 0\tExact onward 2\n"
            + "300 300 0\t200 200 0\tOnward transport 3\n"
            + "102 100 0\t301 300 0\tOnly nearby origin 4\n"
            + "103 100 0\t300 300 1\tWrong plane 5\n"
            + "\t201 200 0\tOnly nearby walking 6\n"
            + "104 100 0\t\tNetwork departure 7\n", p -> p.equals(new TransportDiff.Point(200, 200, 0)));
        assertEquals(List.of(5, 6, 7), failures.stream().map(v -> v.get("line")).collect(Collectors.toList()));
        for (var failure : failures) {
            assertEquals("destination", failure.get("invariant"));
            assertEquals(((TransportDiff.Row) failure.get("row")).destination, failure.get("focus"));
        }
    }

    @Test void bundledFindingsAreThePluginLoadersBlockedLandingsWithoutAnOnwardTransport() {
        var transports = ResourceLoader.transports();
        var collision = new CollisionMap(PluginResources.map());
        Set<Integer> origins = new HashSet<>();
        for (var entry : transports.entrySet()) {
            if (entry.getValue().stream().anyMatch(t -> t.getType() != TransportType.SEASONAL_TRANSPORTS)) origins.add(entry.getKey());
        }
        Set<TransportDiff.Point> expected = new HashSet<>();
        for (var entries : transports.values()) for (var transport : entries) {
            if (transport.getType() == TransportType.SEASONAL_TRANSPORTS) continue;
            int packed = transport.getDestination();
            var point = new TransportDiff.Point(WorldPointUtil.unpackWorldX(packed), WorldPointUtil.unpackWorldY(packed), WorldPointUtil.unpackWorldPlane(packed));
            if (collision.isBlocked(point.x, point.y, point.plane) && !origins.contains(packed)) expected.add(point);
        }
        var findings = new TransportInvariants.Findings();
        DestinationViolations.collect(TransportInvariants.transportRows(), p -> !collision.isBlocked(p.x, p.y, p.plane), findings);
        Set<TransportDiff.Point> actual = new HashSet<>();
        for (var finding : findings.list) {
            assertNotEquals(TransportInvariants.SEASONAL, finding.get("file"));
            actual.add((TransportDiff.Point) finding.get("focus"));
        }
        assertEquals(expected, actual);
    }

    @Test void identitiesSurviveLineInsertionsAndDuplicatesStayDistinct() {
        String raw = "100 100 0\t200 200 0\tArrive 1";
        var first = check(raw, p -> false);
        var shifted = check("# unrelated\n" + raw + "\n" + raw, p -> false);
        assertEquals(first.get(0).get("id"), shifted.get(0).get("id"));
        assertEquals(first.get(0).get("id") + "-2", shifted.get(1).get("id"));
        assertEquals(3, shifted.get(0).get("line"));
    }
}

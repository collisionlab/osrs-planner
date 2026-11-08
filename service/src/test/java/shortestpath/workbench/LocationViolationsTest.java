package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LocationViolationsTest {
    static final String FILE = "src/main/resources/destinations/game_features/bank.tsv";

    /**
     * Component 1 (5 tiles) is reachable, component 2 (40 tiles) is not, and x >= 300 is blocked. A blocked
     * tile at x 300-309 is a counter beside reachable ground, so a route snaps to it; past that, nothing is.
     */
    static final LocationViolations.Components COMPONENTS = new LocationViolations.Components() {
        @Override public int component(TransportDiff.Point point) { return point.x >= 300 ? -1 : point.x < 200 ? 1 : 2; }
        @Override public boolean reachable(int component) { return component == 1; }
        @Override public int size(int component) { return component == 1 ? 5 : 40; }
        @Override public boolean endsRoutes(TransportDiff.Point point) {
            int component = component(point);
            return component >= 0 ? reachable(component) : point.x < 310;
        }
    };

    @Test void reportsBlockedLocationsAndLocationsInUnreachedAreas() {
        var findings = new TransportInvariants.Findings();
        LocationViolations.collect(TransportInvariants.rows(FILE, "# Destination\tInfo\n"
            + "100 100 0\tReached bank\n" + "250 100 0\tIsland bank\n" + "305 100 0\tBank booth\n"
            + "320 100 0\tBank in a wall\n"), COMPONENTS, findings);
        assertEquals(2, findings.list.size());
        var island = findings.list.get(0);
        assertEquals("location", island.get("invariant"));
        assertEquals(new TransportDiff.Point(250, 100, 0), island.get("focus"));
        assertEquals(Map.of("kind", "bank", "name", "Island bank", "areaTiles", 40), island.get("location"));
        assertTrue(((String) island.get("failure")).contains("40 tiles"));
        var wall = findings.list.get(1);
        assertTrue(((String) wall.get("failure")).contains("blocked tile with no reachable tile within 2"));
        assertNull(((Map<?, ?>) wall.get("location")).get("areaTiles"));
    }

    @Test void reportsClueStepsNoRouteEndsAt() {
        String text = "[\n"
            + "  {\"id\": \"emote-100-100-0\", \"category\": \"emote\", \"start\": [1, 1, 0], \"target\": [100, 100, 0], \"targetSource\": \"a\"},\n"
            + "  {\"id\": \"cryptic-250-100-0\", \"category\": \"cryptic\", \"start\": [1, 1, 0], \"target\": [250, 100, 0], \"targetSource\": \"b\"}\n"
            + "]\n";
        var rows = ClueViolations.rows(text);
        assertEquals(2, rows.size());
        assertEquals(3, rows.get(1).row.line);
        var findings = new TransportInvariants.Findings();
        ClueViolations.collect(rows, COMPONENTS, findings);
        assertEquals(1, findings.list.size());
        var island = findings.list.get(0);
        assertEquals("clue", island.get("invariant"));
        assertEquals(ClueViolations.FILE, island.get("file"));
        assertEquals(Map.of("id", "cryptic-250-100-0", "category", "cryptic", "source", "b", "areaTiles", 40), island.get("clue"));
    }

    @Test void readsTheWholeClueList() {
        var rows = ClueViolations.bundledRows();
        assertTrue(rows.size() > 800, "clue steps: " + rows.size());
        assertEquals(List.of(), rows.stream().filter(row -> row.row.destination == null).map(row -> row.raw).collect(java.util.stream.Collectors.toList()));
    }

    @Test void readsEveryPluginLocationFile() {
        var rows = TransportInvariants.locationRows();
        for (String path : TransportInvariants.LOCATIONS) {
            assertTrue(rows.stream().anyMatch(row -> row.row.file.equals(TransportInvariants.RESOURCES + path)), path);
        }
        assertEquals(List.of(), rows.stream().filter(row -> row.row.destination == null).map(row -> row.raw).collect(java.util.stream.Collectors.toList()));
    }
}

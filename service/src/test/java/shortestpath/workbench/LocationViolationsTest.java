package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LocationViolationsTest {
    static final String FILE = "src/main/resources/destinations/game_features/bank.tsv";

    /** Component 1 (5 tiles) is reachable, component 2 (40 tiles) is not, and x >= 300 is blocked. */
    static final LocationViolations.Components COMPONENTS = new LocationViolations.Components() {
        @Override public int component(TransportDiff.Point point) { return point.x >= 300 ? -1 : point.x < 200 ? 1 : 2; }
        @Override public boolean reachable(int component) { return component == 1; }
        @Override public int size(int component) { return component == 1 ? 5 : 40; }
    };

    @Test void reportsBlockedLocationsAndLocationsInUnreachedAreas() {
        var findings = new TransportInvariants.Findings();
        LocationViolations.collect(TransportInvariants.rows(FILE, "# Destination\tInfo\n"
            + "100 100 0\tReached bank\n" + "250 100 0\tIsland bank\n" + "300 100 0\tBank in a wall\n"), COMPONENTS, findings);
        assertEquals(2, findings.list.size());
        var island = findings.list.get(0);
        assertEquals("location", island.get("invariant"));
        assertEquals(new TransportDiff.Point(250, 100, 0), island.get("focus"));
        assertEquals(Map.of("kind", "bank", "name", "Island bank", "areaTiles", 40), island.get("location"));
        assertTrue(((String) island.get("failure")).contains("40 tiles"));
        var wall = findings.list.get(1);
        assertTrue(((String) wall.get("failure")).contains("blocked tile"));
        assertNull(((Map<?, ?>) wall.get("location")).get("areaTiles"));
    }

    @Test void readsEveryPluginLocationFile() {
        var rows = TransportInvariants.locationRows();
        for (String path : TransportInvariants.LOCATIONS) {
            assertTrue(rows.stream().anyMatch(row -> row.row.file.equals(TransportInvariants.RESOURCES + path)), path);
        }
        assertEquals(List.of(), rows.stream().filter(row -> row.row.destination == null).map(row -> row.raw).collect(java.util.stream.Collectors.toList()));
    }
}

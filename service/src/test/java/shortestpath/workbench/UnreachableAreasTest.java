package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;

class UnreachableAreasTest {
    @Test void countsConnectedTilesOnceAndStopsAtTheReviewLimit() {
        var tiles = new ArrayList<Integer>();
        var small = UnreachableAreas.measure(0, tile -> tile < 4 ? new int[]{0, tile + 1} : new int[]{0}, tiles);
        assertEquals(5, small.tiles);
        assertFalse(small.atLeast);
        assertEquals(5, tiles.size());
        tiles.clear();
        var large = UnreachableAreas.measure(0, tile -> new int[]{tile + 1}, tiles);
        assertEquals(10_000, large.tiles);
        assertTrue(large.atLeast);
        assertEquals(10_000, tiles.size());
    }

    @Test void blockedTilesHaveNoAreaAndMeasurementsStayOnTheirPlane() {
        var collision = new shortestpath.pathfinder.CollisionMap(null) {
            @Override public boolean isBlocked(int x, int y, int plane) { return plane != 1 || x < 100 || x > 102 || y != 100; }
            @Override public int[] ordinaryWalkingNeighbors(int tile) {
                int x = shortestpath.WorldPointUtil.unpackWorldX(tile);
                return x < 102 ? new int[]{shortestpath.WorldPointUtil.packWorldPoint(x + 1, 100, 1)} : new int[0];
            }
        };
        var areas = new UnreachableAreas(collision);
        assertEquals(0, areas.at(new TransportDiff.Point(100, 100, 0)).tiles);
        assertEquals(3, areas.at(new TransportDiff.Point(100, 100, 1)).tiles);
        assertEquals(3, areas.at(new TransportDiff.Point(101, 100, 1)).tiles);
    }
}

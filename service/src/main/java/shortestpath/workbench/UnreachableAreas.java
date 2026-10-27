package shortestpath.workbench;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.function.IntFunction;
import shortestpath.WorldPointUtil;
import shortestpath.pathfinder.CollisionMap;

/** Candidate-local walking areas, capped at the largest review bucket. */
final class UnreachableAreas {
    static final int LIMIT = 10_000;
    static final class Area {
        public final int tiles;
        public final boolean atLeast;
        Area(int tiles, boolean atLeast) { this.tiles = tiles; this.atLeast = atLeast; }
    }
    private final Map<Integer, Area> cached = new HashMap<>();
    private final CollisionMap collision;

    UnreachableAreas(CollisionMap collision) { this.collision = collision; }

    synchronized Area at(TransportDiff.Point point) {
        int tile = WorldPointUtil.packWorldPoint(point.x, point.y, point.plane);
        Area previous = cached.get(tile);
        if (previous != null) return previous;
        if (collision.isBlocked(point.x, point.y, point.plane)) return new Area(0, false);
        var tiles = new ArrayList<Integer>();
        Area area = measure(tile, collision::ordinaryWalkingNeighbors, tiles);
        for (int visited : tiles) cached.put(visited, area);
        return area;
    }

    static Area measure(int start, IntFunction<int[]> neighbors, ArrayList<Integer> tiles) {
        var seen = new HashSet<Integer>();
        seen.add(start);
        tiles.add(start);
        for (int i = 0; i < tiles.size(); i++) {
            for (int next : neighbors.apply(tiles.get(i))) {
                if (!seen.add(next)) continue;
                tiles.add(next);
                if (tiles.size() == LIMIT) return new Area(LIMIT, true);
            }
        }
        return new Area(tiles.size(), false);
    }
}

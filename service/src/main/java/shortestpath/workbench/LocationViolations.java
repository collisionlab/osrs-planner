package shortestpath.workbench;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import shortestpath.WorldPointUtil;
import shortestpath.candidates.Walking;
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.PluginResources;
import shortestpath.pathfinder.TargetReachability;
import shortestpath.pathfinder.astar.RoutingStaticBuilder;
import shortestpath.transport.ResourceLoader;

/**
 * Banks, altars, anvils and other locations no route can ever end at: snapped as the plugin snaps a
 * target ({@link TargetReachability}), nothing is reachable at or beside them.
 */
final class LocationViolations {
    static final String RULE = "A route can end at every location (bank, altar, anvil, apothecary): the tile, or, snapped "
        + "as the plugin snaps a target, a tile within " + TargetReachability.DEFAULT_UNREACHABLE_DISTANCE
        + " of it, is in a walking area that a chain of transports reaches from Lumbridge, ignoring requirements.";

    private LocationViolations() { }

    /** Which walking component a tile is in, and whether transports reach it from Lumbridge. */
    interface Components {
        /** The tile's component, or -1 when it is not walkable. */
        int component(TransportDiff.Point point);

        boolean reachable(int component);

        int size(int component);

        /** A route can end at the point, snapped as the plugin snaps a target. */
        boolean endsRoutes(TransportDiff.Point point);

        /** The plugin's structural reachability over its bundled collision and transports, built once. */
        static Components bundled() {
            return Bundled.INSTANCE;
        }
    }

    /** The bundled walking graph behind {@link Components#bundled()}, shared with the transport candidates. */
    static Walking bundledWalking() {
        return Bundled.INSTANCE.walking;
    }

    private static final class Bundled implements Components {
        static final Bundled INSTANCE = new Bundled();
        private final Walking walking;
        private final int[] sizes;
        private final TargetReachability snapping;

        private Bundled() {
            CollisionMap collision = new CollisionMap(PluginResources.map());
            walking = walking(RoutingStaticBuilder.walkingGraph(collision, ResourceLoader.transports()));
            sizes = walking.areaSizes();
            snapping = new TargetReachability(collision, walking, PluginResources.transports(),
                TargetReachability.DEFAULT_UNREACHABLE_DISTANCE);
        }

        /** The plugin keeps its walking-graph builder in its test sources (compiled in by service/build.gradle). */
        private static Walking walking(RoutingStaticBuilder.WalkingGraph graph) {
            return new Walking() {
                @Override public int tileCount() { return graph.tileCount(); }
                @Override public int tile(int index) { return graph.tile(index); }
                @Override public int indexOf(int tile) { return graph.indexOf(tile); }
                @Override public int naturalComponentCount() { return graph.naturalComponentCount(); }
                @Override public int naturalComponent(int index) { return graph.naturalComponent(index); }
                @Override public boolean isStructurallyReachable(int component) { return graph.isStructurallyReachable(component); }
            };
        }

        @Override public int component(TransportDiff.Point point) {
            int index = walking.indexOf(WorldPointUtil.packWorldPoint(point.x, point.y, point.plane));
            return index < 0 ? -1 : walking.naturalComponent(index);
        }

        @Override public boolean reachable(int component) {
            return walking.isStructurallyReachable(component);
        }

        @Override public int size(int component) {
            return sizes[component];
        }

        @Override public boolean endsRoutes(TransportDiff.Point point) {
            int target = WorldPointUtil.packWorldPoint(point.x, point.y, point.plane);
            return snapping.resolve(target).outcome != TargetReachability.Outcome.NEVER;
        }
    }

    static void collect(List<TransportInvariants.CurrentRow> rows, Components components, TransportInvariants.Findings findings) {
        for (var current : rows) {
            var point = current.row.destination;
            if (point == null) continue;
            if (components.endsRoutes(point)) continue;
            int component = components.component(point);
            String kind = current.row.file.substring(current.row.file.lastIndexOf('/') + 1).replace(".tsv", "");
            var finding = findings.add("location", current, point, "The " + kind + " " + never(point, components));
            Map<String, Object> location = new LinkedHashMap<>();
            location.put("kind", kind);
            location.put("name", current.row.label);
            location.put("areaTiles", component < 0 ? null : components.size(component));
            finding.put("location", location);
        }
    }

    /** Why no route ends at the point, completing "The bank …". */
    static String never(TransportDiff.Point point, Components components) {
        int component = components.component(point);
        return component < 0 || components.reachable(component)
            ? "is on a blocked tile with no reachable tile within " + TargetReachability.DEFAULT_UNREACHABLE_DISTANCE + " of it."
            : "is in a walking area of " + String.format("%,d", components.size(component))
                + " tiles that no chain of transports reaches from Lumbridge, with no reachable tile within "
                + TargetReachability.DEFAULT_UNREACHABLE_DISTANCE + " of it.";
    }
}

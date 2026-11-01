package shortestpath.workbench;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import shortestpath.WorldPointUtil;
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.PluginResources;
import shortestpath.pathfinder.astar.RoutingStaticBuilder;
import shortestpath.transport.ResourceLoader;

/** Banks, altars, anvils and other locations that are blocked or in a walking area nothing reaches. */
final class LocationViolations {
    static final String RULE = "A location (bank, altar, anvil, apothecary) is a walkable tile in a walking area that a "
        + "chain of transports reaches from Lumbridge, ignoring requirements.";

    private LocationViolations() { }

    /** Which walking component a tile is in, and whether transports reach it from Lumbridge. */
    interface Components {
        /** The tile's component, or -1 when it is not walkable. */
        int component(TransportDiff.Point point);

        boolean reachable(int component);

        int size(int component);

        /** The plugin's structural reachability over its bundled collision and transports, built once. */
        static Components bundled() {
            return Bundled.INSTANCE;
        }
    }

    private static final class Bundled implements Components {
        static final Bundled INSTANCE = new Bundled();
        private final RoutingStaticBuilder.WalkingGraph walking;
        private final int[] sizes;

        private Bundled() {
            walking = RoutingStaticBuilder.walkingGraph(new CollisionMap(PluginResources.map()), ResourceLoader.transports());
            sizes = new int[walking.naturalComponentCount() + 1];
            for (int i = 0; i < walking.tileCount(); i++) sizes[walking.naturalComponent(i)]++;
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
    }

    static void collect(List<TransportInvariants.CurrentRow> rows, Components components, TransportInvariants.Findings findings) {
        for (var current : rows) {
            var point = current.row.destination;
            if (point == null) continue;
            int component = components.component(point);
            if (component >= 0 && components.reachable(component)) continue;
            String kind = current.row.file.substring(current.row.file.lastIndexOf('/') + 1).replace(".tsv", "");
            var finding = findings.add("location", current, point, component < 0
                ? "The " + kind + " is on a blocked tile."
                : "The " + kind + " is in a walking area of " + String.format("%,d", components.size(component))
                    + " tiles that no chain of transports reaches from Lumbridge.");
            Map<String, Object> location = new LinkedHashMap<>();
            location.put("kind", kind);
            location.put("name", current.row.label);
            location.put("areaTiles", component < 0 ? null : components.size(component));
            finding.put("location", location);
        }
    }
}

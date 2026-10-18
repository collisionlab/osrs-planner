package shortestpath.service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import shortestpath.WorldPointUtil;
import shortestpath.transport.Transport;
import shortestpath.transport.ResourceLoader;
import shortestpath.transport.TransportType;

/**
 * The plugin's ladders, stairs and other physical transports that change plane in place, as
 * {@code GET /v1/plane-links} returns them. The inset map offers an upper floor only where one of
 * these leads to it, so a floor no transport reaches is never offered.
 */
final class PlaneLinks {
    /** Farther apart than this, a plane change is a journey (a glider, a cave), not a way upstairs. */
    private static final int MAX_DISTANCE = 12;

    /** One link: where it starts and ends as {@code [x, y, plane]}, and the plugin's name for it. */
    public static final class Link {
        public final int[] from;
        public final int[] to;
        public final String name;

        Link(int from, int to, String name) {
            this.from = point(from);
            this.to = point(to);
            this.name = name;
        }
    }

    static final List<Link> LINKS = load(ResourceLoader.transports().values());

    private PlaneLinks() { }

    static List<Link> load(Collection<Set<Transport>> transports) {
        Map<String, Link> links = new LinkedHashMap<>();
        for (Set<Transport> from : transports) {
            for (Transport transport : from) {
                if (!isLink(transport)) {
                    continue;
                }
                Link link = new Link(transport.getOrigin(), transport.getDestination(), name(transport));
                links.putIfAbsent(link.from[0] + "," + link.from[1] + "," + link.from[2] + ">" + link.to[2], link);
            }
        }
        List<Link> result = new ArrayList<>(links.values());
        result.sort(Comparator.comparingInt((Link link) -> link.from[2]).thenComparingInt(link -> link.from[0])
            .thenComparingInt(link -> link.from[1]));
        return result;
    }

    private static boolean isLink(Transport transport) {
        TransportType type = transport.getType();
        int origin = transport.getOrigin(), destination = transport.getDestination();
        return (type == TransportType.TRANSPORT || type == TransportType.AGILITY_SHORTCUT || type == TransportType.GRAPPLE_SHORTCUT)
            && origin != Transport.UNDEFINED_ORIGIN && destination != Transport.UNDEFINED_DESTINATION
            && WorldPointUtil.unpackWorldPlane(origin) != WorldPointUtil.unpackWorldPlane(destination)
            && WorldPointUtil.distanceBetween2D(origin, destination) <= MAX_DISTANCE;
    }

    private static String name(Transport transport) {
        String name = transport.getObjectInfo() != null ? transport.getObjectInfo() : transport.getDisplayInfo();
        // Object info reads "Climb-up Ladder 16683": drop the object id.
        return name == null ? "" : name.replaceAll("\\s+\\d+$", "");
    }

    private static int[] point(int packed) {
        return new int[] {WorldPointUtil.unpackWorldX(packed), WorldPointUtil.unpackWorldY(packed), WorldPointUtil.unpackWorldPlane(packed)};
    }
}

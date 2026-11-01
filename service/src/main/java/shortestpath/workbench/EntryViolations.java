package shortestpath.workbench;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Transport rows that start on a blocked tile no chain of transports reaches from open ground. The
 * router lets a route walk onto such an origin from a neighbouring tile, which the game does not.
 */
final class EntryViolations {
    static final String RULE = "A transport starts on a walkable tile, or on a blocked tile that a chain of transports "
        + "reaches from open ground or a teleport. Fairy rings are not checked yet.";
    static final String FAIRY_RINGS = TransportInvariants.RESOURCES + shortestpath.transport.TransportType.FAIRY_RING.getResourcePath();

    private EntryViolations() { }

    /** {@code rows} are the non-seasonal rows. */
    static void collect(List<TransportInvariants.CurrentRow> rows, Predicate<TransportDiff.Point> walkable,
        TransportInvariants.Findings findings) {
        Set<TransportDiff.Point> reached = reached(rows, walkable);
        for (var current : rows) {
            var origin = current.row.origin;
            if (origin == null || current.row.file.equals(FAIRY_RINGS) || walkable.test(origin) || reached.contains(origin)) continue;
            findings.add("entry", current, origin,
                "Starts on a blocked tile that no transport reaches, so a route can only walk onto it.");
        }
    }

    /**
     * Blocked tiles a transport lands on, from open ground or a teleport, directly or along a chain.
     * Fairy rings count as entries too until they are checked.
     */
    static Set<TransportDiff.Point> reached(List<TransportInvariants.CurrentRow> rows, Predicate<TransportDiff.Point> walkable) {
        Map<TransportDiff.Point, List<TransportDiff.Point>> onward = new HashMap<>();
        ArrayDeque<TransportDiff.Point> pending = new ArrayDeque<>();
        for (var current : rows) {
            var row = current.row;
            if (row.destination == null) continue;
            if (row.origin == null || walkable.test(row.origin) || row.file.equals(FAIRY_RINGS)) pending.add(row.destination);
            else onward.computeIfAbsent(row.origin, key -> new java.util.ArrayList<>()).add(row.destination);
        }
        Set<TransportDiff.Point> reached = new HashSet<>();
        while (!pending.isEmpty()) {
            var tile = pending.pop();
            if (walkable.test(tile) || !reached.add(tile)) continue;
            pending.addAll(onward.getOrDefault(tile, List.of()));
        }
        return reached;
    }
}

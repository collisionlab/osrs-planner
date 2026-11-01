package shortestpath.workbench;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;

/** Transport rows whose destination is neither walkable nor an exact transport origin. */
final class DestinationViolations {
    static final String RULE = "A transport lands on a walkable tile or on the exact origin of another transport.";

    private DestinationViolations() { }

    /** {@code rows} are the non-seasonal rows: seasonal rows neither fail nor exempt a landing tile. */
    static void collect(List<TransportInvariants.CurrentRow> rows, Predicate<TransportDiff.Point> walkable,
        TransportInvariants.Findings findings) {
        Set<TransportDiff.Point> origins = new HashSet<>();
        for (var current : rows) if (current.row.origin != null) origins.add(current.row.origin);
        for (var current : rows) {
            var row = current.row;
            if (row.destination == null || walkable.test(row.destination) || origins.contains(row.destination)) continue;
            findings.add("destination", current, row.destination,
                "Lands on a blocked tile where no transport starts.");
        }
    }
}

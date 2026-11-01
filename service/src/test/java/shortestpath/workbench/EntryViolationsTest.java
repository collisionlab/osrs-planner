package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class EntryViolationsTest {
    static final String FILE = "src/main/resources/transports/transports.tsv";
    static final String HEADER = "# Origin\tDestination\tmenuOption menuTarget objectID";
    /** Open ground is x < 200; everything at x >= 200 is blocked. */
    static final java.util.function.Predicate<TransportDiff.Point> OPEN = p -> p.x < 200;

    static List<Object> lines(List<TransportInvariants.CurrentRow> rows) {
        var findings = new TransportInvariants.Findings();
        EntryViolations.collect(rows, OPEN, findings);
        findings.list.forEach(finding -> assertEquals("entry", finding.get("invariant")));
        return findings.list.stream().map(finding -> finding.get("line")).collect(Collectors.toList());
    }

    @Test void blockedOriginsPassOnlyWhenAChainFromOpenGroundOrATeleportReachesThem() {
        var rows = TransportInvariants.rows(FILE, HEADER + "\n"
            + "100 100 0\t200 100 0\tChop from open ground 1\n"
            + "200 100 0\t202 100 0\tChop on along the chain 2\n"
            + "202 100 0\t100 102 0\tStep off 3\n"
            + "210 100 0\t211 100 0\tUp a ladder only reached by walking onto it 4\n"
            + "211 100 0\t210 100 0\tDown the same ladder 5\n"
            + "\t220 100 0\tTeleport onto a blocked tile 6\n"
            + "220 100 0\t100 100 0\tLeave the teleport landing 7\n"
            + "100 101 0\t230 100 1\tOther plane 8\n"
            + "230 100 0\t100 100 0\tSame tile on plane 0 9\n");
        assertEquals(List.of(5, 6, 10), lines(rows), "lines count the header");
    }

    @Test void fairyRingsAreNotCheckedButStartChains() {
        var rows = new java.util.ArrayList<>(TransportInvariants.rows(EntryViolations.FAIRY_RINGS, HEADER + "\n"
            + "200 200 0\t240 100 0\tFairy ring on its blocked tile 1\n"));
        rows.addAll(TransportInvariants.rows(FILE, HEADER + "\n" + "240 100 0\t100 100 0\tAfter the fairy ring 1\n"));
        assertEquals(List.of(), lines(rows));
    }

    @Test void reachedFollowsChainsOnlyThroughBlockedTiles() {
        var rows = TransportInvariants.rows(FILE, HEADER + "\n"
            + "100 100 0\t200 100 0\tIn 1\n" + "200 100 0\t150 100 0\tOut to open ground 2\n" + "150 100 0\t250 100 0\tWalkable origin 3\n");
        assertEquals(Set.of(new TransportDiff.Point(200, 100, 0), new TransportDiff.Point(250, 100, 0)), EntryViolations.reached(rows, OPEN));
    }
}

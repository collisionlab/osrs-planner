package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class DestinationViolationsTest {
    static final String FILE = "src/main/resources/transports/transports.tsv";
    static final String HEADER = "# Origin\tDestination\tmenuOption menuTarget objectID";

    @Test void exactOriginsAndWalkableTilesPassButNearbyTilesAndOtherPlanesDoNot() {
        var rows = TransportCandidates.rows(FILE, HEADER + "\n"
            + "100 100 0\t200 200 0\tWalkable arrival 1\n"
            + "101 100 0\t300 300 0\tExact onward 2\n"
            + "300 300 0\t200 200 0\tOnward transport 3\n"
            + "102 100 0\t301 300 0\tOnly nearby origin 4\n"
            + "103 100 0\t300 300 1\tWrong plane 5\n"
            + "\t201 200 0\tOnly nearby walking 6\n"
            + "104 100 0\t\tNetwork departure 7\n");
        var failures = DestinationViolations.collect(rows, p -> p.equals(new TransportDiff.Point(200, 200, 0)), Provenance.bundled());
        assertEquals(3, failures.size());
        assertEquals(List.of(5, 6, 7), failures.stream().map(v -> v.get("originalLine")).collect(java.util.stream.Collectors.toList()));
        for (var failure : failures) {
            assertEquals("destination_violation", failure.get("kind"));
            assertNull(failure.get("suggested"));
            assertEquals("", failure.get("suggestedRaw"));
            assertEquals("violation", ((TransportCandidates.Reconciliation) failure.get("reconciliation")).status);
        }
    }


    @Test void bundledViolationsAgreeWithThePluginTransportLoader() {
        var transports = shortestpath.transport.ResourceLoader.transports();
        var collision = new shortestpath.pathfinder.CollisionMap(shortestpath.pathfinder.PluginResources.map());
        java.util.Set<TransportDiff.Point> expected = new java.util.HashSet<>();
        for (var entries : transports.values()) for (var transport : entries) {
            int packed = transport.getDestination();
            var point = new TransportDiff.Point(shortestpath.WorldPointUtil.unpackWorldX(packed),
                shortestpath.WorldPointUtil.unpackWorldY(packed), shortestpath.WorldPointUtil.unpackWorldPlane(packed));
            if (collision.isBlocked(point.x, point.y, point.plane) && !transports.containsKey(packed)) expected.add(point);
        }
        var candidates = (java.util.List<?>) TransportCandidates.bundled(Provenance.bundled()).get("candidates");
        java.util.Set<TransportDiff.Point> actual = new java.util.HashSet<>();
        int failures = 0;
        for (var entry : candidates) {
            var candidate = (java.util.Map<?, ?>) entry;
            if ("destination_violation".equals(candidate.get("kind"))) {
                actual.add(((TransportDiff.Row) candidate.get("original")).destination);
                failures++;
            }
        }
        assertEquals(expected, actual, "every blocked non-origin destination from the plugin loader is reviewed");
        System.out.printf("Destination violations: %d current TSV rows at %d distinct tiles%n", failures, actual.size());
    }

    @Test void identitiesSurviveLineInsertionsAndDuplicatesStayDistinct() {
        String raw = "100 100 0\t200 200 0\tArrive 1";
        var first = DestinationViolations.collect(TransportCandidates.rows(FILE, HEADER + "\n" + raw), p -> false, Provenance.bundled());
        var shifted = DestinationViolations.collect(TransportCandidates.rows(FILE, HEADER + "\n# unrelated\n" + raw + "\n" + raw), p -> false, Provenance.bundled());
        assertEquals(first.get(0).get("id"), shifted.get(0).get("id"));
        assertNotEquals(shifted.get(0).get("id"), shifted.get(1).get("id"));
        assertEquals(3, shifted.get(0).get("originalLine"));
    }
}

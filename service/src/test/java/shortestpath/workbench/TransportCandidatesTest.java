package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.testtools.JavalinTest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TransportCandidatesTest {
    static final String FILE = "src/main/resources/transports/transports.tsv";
    static final String HEADER = "# Origin\tDestination\tmenuOption menuTarget objectID\tItems\tDisplay info";
    static final String ORIGINAL = "100 200 0\t300 400 1\tClimb Stairs 42\t\t";
    static final String SUGGESTED = "101 200 0\t300 400 2\tClimb Stairs 42\t\t";
    static final ObjectMapper JSON = new ObjectMapper();

    static TransportCandidates.Reconciliation reconcile(String contents) {
        return TransportCandidates.reconcile(ORIGINAL, SUGGESTED,
            TransportCandidates.parse(FILE, 88, ORIGINAL, HEADER), TransportCandidates.rows(FILE, HEADER + "\n" + contents));
    }

    @Test void sourcedTransportsSplitWhenEitherOrBothEndsAreOutsideRouting() {
        var row = TransportCandidates.parse(FILE, 2, SUGGESTED, HEADER);
        assertEquals("sourced_transport", TransportCandidates.sourcedCategory(row, p -> true));
        assertEquals("sourced_transport_outside_routing", TransportCandidates.sourcedCategory(row, row.origin::equals));
        assertEquals("sourced_transport_outside_routing", TransportCandidates.sourcedCategory(row, row.destination::equals));
        assertEquals("sourced_transport_outside_routing", TransportCandidates.sourcedCategory(row, p -> false));
    }

    @Test void exactRowsNotLineNumbersAndAlreadyPresent() {
        assertEquals("matches_current", reconcile("# unrelated new section\n" + ORIGINAL).status);
        assertEquals(3, reconcile("# section\n" + ORIGINAL).rows.get(0).row.line);
        assertEquals("already_present", reconcile(SUGGESTED).status);
        assertEquals("ambiguous", reconcile(ORIGINAL + "\n" + ORIGINAL).status);
        assertEquals("ambiguous", reconcile(SUGGESTED + "\n" + SUGGESTED).status);
    }

    @Test void changedRequirementsMetadataOrGeometryAreNeverAnExactMatch() {
        assertEquals("diverged", reconcile(ORIGINAL.replace("\t\t", "\tRope\t")).status);
        assertEquals("diverged", reconcile(ORIGINAL + "new display info").status);
        assertEquals("diverged", reconcile(ORIGINAL.replace("300 400 1", "301 400 1")).status);
        assertEquals("diverged", reconcile(ORIGINAL.replace("Stairs 42", "Stairs 43")).status);
        // A short row with the same parsed empty fields is still not an exact original TSV row.
        assertEquals("diverged", reconcile(ORIGINAL.substring(0, ORIGINAL.length() - 2)).status);
    }

    @Test void nearbyRowsAreNotIdentitiesAndPossibleMatchesAreExplicit() {
        assertTrue(TransportCandidates.currentRows("removed-file.tsv", FILE).isEmpty());
        assertEquals("missing", reconcile("").status);
        assertEquals("missing", reconcile(ORIGINAL.replace("100 200", "101 201").replace("300 400", "301 401")).status);
        String oneEnd = ORIGINAL.replace("300 400 1", "310 410 1");
        assertEquals("ambiguous", reconcile(oneEnd + "\n" + oneEnd.replace("310 410", "320 420")).status);
    }

    @Test void parsesThePinnedCatalogueWithTheSharedParser() {
        JsonNode imported = TransportCandidates.json("/candidates/catalogue.json");
        assertEquals(4635, imported.size());
        Map<String, Object> loaded = TransportCandidates.bundled(Provenance.bundled());
        JsonNode served = JSON.valueToTree(loaded).path("candidates");
        assertEquals(4635, served.findValuesAsText("category").stream().filter(c -> !c.equals("destination_violation")).count());
        assertTrue(served.size() > 4635, "current destination failures are included");
        assertEquals(2, served.findValuesAsText("category").stream().filter("plane"::equals).count());
        assertEquals(32, served.findValuesAsText("category").stream().filter("non_floor"::equals).count());
        assertEquals(212, served.findValuesAsText("category").stream().filter("coordinate_offset"::equals).count());
        long inside = served.findValuesAsText("category").stream().filter("sourced_transport"::equals).count();
        long outside = served.findValuesAsText("category").stream().filter("sourced_transport_outside_routing"::equals).count();
        assertEquals(1587, inside + outside);
        assertTrue(inside > 0 && outside > 0, "the bundled catalogue exercises both routing categories");
        System.out.printf("Sourced transports: %d inside routing, %d with an endpoint outside%n", inside, outside);
        JsonNode first = served.get(0);
        assertTrue(first.path("original").path("origin").isNull(), "teleport has no invented origin");
        assertEquals(2862, first.path("original").path("destination").path("x").asInt());
        assertEquals(2997, first.path("original").path("destination").path("y").asInt());
        assertEquals(0, first.path("original").path("destination").path("plane").asInt());
        assertEquals(1, first.path("suggested").path("destination").path("plane").asInt());
        for (JsonNode candidate : served) {
            assertEquals("unreviewed", candidate.path("review").path("status").asText());
            if (candidate.path("kind").asText().equals("destination_violation")) {
                assertEquals("violation", candidate.path("reconciliation").path("status").asText());
                assertTrue(candidate.path("suggested").isNull());
                assertEquals("", candidate.path("suggestedRaw").asText());
                continue;
            }
            assertTrue(Set.of("matches_current", "already_present", "diverged", "missing", "ambiguous", "proposed_new", "possible_existing")
                .contains(candidate.path("reconciliation").path("status").asText()));
            JsonNode source = imported.get(servedIndex(served, candidate));
            assertEquals(source.path("originalRaw").asText(), candidate.path("originalRaw").asText());
            assertEquals(source.path("suggestedRaw").asText(), candidate.path("suggestedRaw").asText());
        }
    }

    static int servedIndex(JsonNode rows, JsonNode candidate) {
        for (int i = 0; i < rows.size(); i++) if (rows.get(i) == candidate) return i;
        throw new AssertionError();
    }

    @Test void ledgerRequiresKnownIdsAndExplainedDecisions() throws Exception {
        TransportCandidates.validateLedger(JSON.readTree("{}"), Set.of("known"));
        TransportCandidates.validateLedger(JSON.readTree("{\"known\":{\"status\":\"accepted\",\"explanation\":\"Verified in game\",\"reference\":\"commit abc\"}}"), Set.of("known"));
        for (String invalid : List.of("{\"unknown\":{\"status\":\"deferred\",\"explanation\":\"Later\"}}",
            "{\"known\":{\"status\":\"accepted\"}}", "{\"known\":{\"status\":\"guess\",\"explanation\":\"?\"}}",
            "{\"known\":{\"status\":\"deferred\",\"explanation\":\"Later\",\"extra\":true}}")) {
            assertThrows(IllegalArgumentException.class, () -> TransportCandidates.validateLedger(JSON.readTree(invalid), Set.of("known")));
        }
    }

    @Test void newProposalsOnlyReportPossibleExistingGeometryAndNeverEquivalentRequirements() {
        TransportDiff.Row proposal = TransportCandidates.parse(FILE, 1, ORIGINAL, HEADER);
        assertEquals("proposed_new", TransportCandidates.reconcileAddition(proposal, List.of(), false).status);
        List<TransportCandidates.CurrentRow> changedNeeds = TransportCandidates.rows(FILE, HEADER + "\n" + ORIGINAL + "changed requirements");
        assertEquals("possible_existing", TransportCandidates.reconcileAddition(proposal, changedNeeds, false).status);
        assertEquals("ambiguous", TransportCandidates.reconcileAddition(proposal,
            TransportCandidates.rows(FILE, HEADER + "\n" + ORIGINAL + "\n" + ORIGINAL), false).status);
        assertEquals("proposed_new", TransportCandidates.reconcileAddition(proposal,
            TransportCandidates.rows(FILE, HEADER + "\n" + ORIGINAL.replace("100 200", "101 201")), false).status);
        // Network-stop checks may identify just a boarding or landing row, without creating edges.
        assertEquals("possible_existing", TransportCandidates.reconcileAddition(proposal,
            TransportCandidates.rows(FILE, HEADER + "\n" + ORIGINAL.replace("300 400", "310 410")), true).status);
    }

    @Test void servesNewProposalsNotesAndUncheckedEvidenceWithoutInventingOriginalRows() {
        JsonNode catalogue = JSON.valueToTree(TransportCandidates.bundled(Provenance.bundled()));
        JsonNode rows = catalogue.path("candidates");
        assertEquals(9, catalogue.path("itemGroups").size());
        int notes = 0, additions = 0, stops = 0;
        for (JsonNode row : rows) {
            switch (row.path("kind").asText()) {
                case "requirement_note":
                    notes++;
                    assertTrue(row.path("suggested").isNull());
                    assertEquals("", row.path("suggestedRaw").asText());
                    assertFalse(row.path("original").isNull());
                    break;
                case "addition":
                    additions++;
                    assertTrue(row.path("original").isNull());
                    assertTrue(row.path("file").isNull());
                    assertTrue(row.has("uncheckedTicks"));
                    assertTrue(row.has("needs"));
                    assertEquals("bestpath-candidates/" + row.path("sourceFile").asText(), row.path("suggested").path("file").asText());
                    break;
                case "network_stop":
                    stops++;
                    assertTrue(row.path("original").isNull());
                    assertFalse(row.path("network").asText().isBlank());
                    assertFalse(row.path("suggested").path("origin").isNull());
                    assertFalse(row.path("suggested").path("destination").isNull());
                    break;
            }
        }
        assertEquals(39, notes);
        assertEquals(3872, additions);
        assertEquals(21, stops);
    }

    @Test void servesReadOnlyCatalogueWithRunningPluginProvenance() {
        Javalin app = Javalin.create();
        Workbench.transportRoutes(app, () -> null, Provenance.bundled());
        JavalinTest.test(app, (server, client) -> {
                try (var response = client.get("/workbench/v1/candidates")) {
                    JsonNode body = JSON.readTree(response.body().string());
                    assertEquals(200, response.code());
                    assertTrue(body.path("candidates").size() > 4635);
                    assertEquals(9, body.path("itemGroups").size());
                    assertEquals(Provenance.bundled().plugin.rev, body.path("plugin").path("rev").asText());
                }
            });
    }
}

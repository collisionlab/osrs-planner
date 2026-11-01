package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.testtools.JavalinTest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

class TransportInvariantsTest {
    static final ObjectMapper JSON = new ObjectMapper();

    @Test void ledgerRequiresKnownIdsAndExplainedDecisions() throws Exception {
        TransportInvariants.validateLedger(JSON.readTree("{}"), Set.of("known"));
        TransportInvariants.validateLedger(JSON.readTree("{\"known\":{\"status\":\"accepted\",\"explanation\":\"Verified in game\",\"reference\":\"commit abc\"}}"), Set.of("known"));
        for (String invalid : List.of("{\"unknown\":{\"status\":\"deferred\",\"explanation\":\"Later\"}}",
            "{\"known\":{\"status\":\"accepted\"}}", "{\"known\":{\"status\":\"guess\",\"explanation\":\"?\"}}",
            "{\"known\":{\"status\":\"deferred\",\"explanation\":\"Later\",\"extra\":true}}")) {
            assertThrows(IllegalArgumentException.class, () -> TransportInvariants.validateLedger(JSON.readTree(invalid), Set.of("known")));
        }
    }

    @Test void findingIdsAreUniqueAndEachInvariantHasARule() {
        Map<String, Object> bundled = TransportInvariants.bundled(Provenance.bundled());
        @SuppressWarnings("unchecked") var findings = (List<Map<String, Object>>) bundled.get("findings");
        assertEquals(findings.size(), findings.stream().map(f -> f.get("id")).distinct().count());
        Map<String, Integer> counts = new TreeMap<>();
        for (var finding : findings) counts.merge((String) finding.get("invariant"), 1, Integer::sum);
        assertTrue(((Map<?, ?>) bundled.get("rules")).keySet().containsAll(counts.keySet()));
        System.out.println("Invariant findings: " + counts);
    }

    @Test void servesTheFindingsWithRunningPluginProvenance() {
        Javalin app = Javalin.create();
        Workbench.transportRoutes(app, () -> null, Provenance.bundled());
        JavalinTest.test(app, (server, client) -> {
            try (var response = client.get("/workbench/v1/invariants")) {
                JsonNode body = JSON.readTree(response.body().string());
                assertEquals(200, response.code());
                assertTrue(body.path("findings").isArray());
                assertEquals(3, body.path("rules").size());
                assertEquals(Provenance.bundled().plugin.rev, body.path("plugin").path("rev").asText());
            }
        });
    }
}

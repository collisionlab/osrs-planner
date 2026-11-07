package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.testtools.JavalinTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import shortestpath.candidates.Report;

class CandidatesViewTest {
    static final ObjectMapper JSON = new ObjectMapper();

    static Report report(String... ids) {
        var report = new Report();
        for (String id : ids) {
            var item = new Report.Item();
            item.id = id;
            item.kind = "area";
            report.items.add(item);
        }
        return report;
    }

    @Test void mergesReviewDecisionsAndRejectsUnknownIds() throws Exception {
        var ledger = JSON.readTree("{\"area-1\":{\"status\":\"deferred\",\"explanation\":\"Upper floor only\"}}");
        Map<String, Object> view = CandidatesView.withReviews(report("area-1", "area-2"), ledger, Provenance.bundled());
        @SuppressWarnings("unchecked") var items = (List<JsonNode>) view.get("items");
        assertEquals("deferred", items.get(0).path("review").path("status").asText());
        assertEquals("unreviewed", items.get(1).path("review").path("status").asText());
        assertThrows(IllegalArgumentException.class, () -> CandidatesView.withReviews(report("area-2"), ledger, Provenance.bundled()));
    }

    @Test void servesTheBundledCandidatesWithAValidLedger() {
        Javalin app = Javalin.create();
        Workbench.transportRoutes(app, () -> null, Provenance.bundled());
        JavalinTest.test(app, (server, client) -> {
            try (var response = client.get("/workbench/v1/candidates")) {
                JsonNode body = JSON.readTree(response.body().string());
                assertEquals(200, response.code());
                JsonNode items = body.path("items");
                java.util.Map<String, Integer> kinds = new java.util.TreeMap<>();
                for (JsonNode item : items) kinds.merge(item.path("kind").asText(), 1, Integer::sum);
                assertEquals(java.util.Set.of("area", "shortcut", "link", "dungeon"), kinds.keySet(), "the bundled snapshot lists every kind");
                assertTrue(kinds.get("area") <= 150 && kinds.get("shortcut") <= 50 && kinds.get("link") <= 50 && kinds.get("dungeon") <= 50,
                    "each list stays within its budget: " + kinds);
                JsonNode first = items.get(0);
                assertTrue(first.path("id").asText().startsWith("area-"));
                assertTrue(first.path("connectors").get(0).path("connector").path("partner").isObject());
                assertTrue(body.path("funnel").has("listed areas"));
                System.out.println("Transport candidates: " + body.path("funnel"));
            }
        });
    }
}

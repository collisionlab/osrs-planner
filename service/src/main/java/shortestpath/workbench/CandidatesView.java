package shortestpath.workbench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import shortestpath.candidates.ConnectorSnapshot;
import shortestpath.candidates.Report;
import shortestpath.candidates.Scope;
import shortestpath.candidates.TransportCandidates;
import shortestpath.candidates.Walking;
import shortestpath.pathfinder.PluginResources;

/**
 * The transport candidates (tooling's shortestpath.candidates): unreached areas with the connectors
 * and world map links into them, and agility shortcuts with no transport, judged against the plugin
 * on this classpath. A row added to the plugin removes its candidate on the next release.
 */
final class CandidatesView {
    private static final ObjectMapper JSON = new ObjectMapper();
    static final String LEDGER = "/candidates/reviews.json";

    private CandidatesView() { }

    /** The plugin data on the classpath never changes, so the judgement is made once. */
    private static final class Judged {
        static final Report REPORT = TransportCandidates.judge(ConnectorSnapshot.bundled(),
            Walking.of(LocationViolations.bundledWalking()), PluginResources.transports(),
            PluginResources.destinations(), Scope.bundled());
    }

    /** The bundled candidates with their review ledger decisions. */
    static Map<String, Object> bundled(Provenance provenance) {
        return withReviews(Judged.REPORT, ledger(), provenance);
    }

    static JsonNode ledger() {
        try {
            return JSON.readTree(TransportInvariants.resource(LEDGER));
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    static Map<String, Object> withReviews(Report report, JsonNode ledger, Provenance provenance) {
        List<ObjectNode> items = JSON.convertValue(report.items, JSON.getTypeFactory().constructCollectionType(List.class, ObjectNode.class));
        Set<String> ids = new HashSet<>();
        for (ObjectNode item : items) ids.add(item.path("id").asText());
        TransportInvariants.validateLedger(ledger, ids, "candidates/reviews.json");
        for (ObjectNode item : items) {
            JsonNode decision = ledger.get(item.path("id").asText());
            item.set("review", decision != null ? decision : JSON.createObjectNode().put("status", "unreviewed"));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rule", report.rule);
        result.put("cache", report.cache);
        result.put("snapshotPlugin", report.snapshotPlugin);
        result.put("extraction", report.extraction);
        result.put("funnel", report.funnel);
        result.put("shortcutMarker", report.shortcutMarker);
        result.put("items", items);
        result.put("plugin", provenance.plugin);
        result.put("tooling", provenance.tooling);
        return result;
    }
}

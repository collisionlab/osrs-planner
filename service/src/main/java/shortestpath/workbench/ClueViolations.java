package shortestpath.workbench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import shortestpath.pathfinder.TargetReachability;

/**
 * Clue steps no route can ever end at, by the same rule as {@link LocationViolations}. The steps are
 * tooling's clue list (its {@code clue-locations} scenario suite), one JSON object per line.
 */
final class ClueViolations {
    static final String RULE = "A route can end at every clue step's tile: the tile, or, snapped as the plugin snaps a "
        + "target, a tile within " + TargetReachability.DEFAULT_UNREACHABLE_DISTANCE + " of it, is in a walking area that "
        + "a chain of transports reaches from Lumbridge, ignoring requirements.";
    static final String RESOURCE = "/scenarios/clue-locations.json";
    /** The clue list's path in the tooling repository. */
    static final String FILE = "scenarios/src/main/resources" + RESOURCE;
    private static final ObjectMapper JSON = new ObjectMapper();

    private ClueViolations() { }

    /** Each clue step as a location row: its target is the destination, its name the info, its category the section. */
    static List<TransportInvariants.CurrentRow> rows(String text) {
        String[] lines = text.split("\r?\n", -1);
        List<TransportInvariants.CurrentRow> rows = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (!line.startsWith("{")) continue;
            JsonNode clue;
            try {
                clue = JSON.readTree(line.endsWith(",") ? line.substring(0, line.length() - 1) : line);
            } catch (IOException error) {
                throw new UncheckedIOException(FILE + ":" + (i + 1), error);
            }
            JsonNode target = clue.path("target");
            Map<String, String> fields = new LinkedHashMap<>();
            fields.put(TransportDiff.DESTINATION, target.get(0).asInt() + " " + target.get(1).asInt() + " " + target.get(2).asInt());
            fields.put(TransportDiff.INFO, clue.path("id").asText());
            fields.put("Source", clue.path("targetSource").asText());
            rows.add(new TransportInvariants.CurrentRow(lines[i],
                new TransportDiff.Row(FILE, i + 1, clue.path("category").asText(), fields)));
        }
        return rows;
    }

    static List<TransportInvariants.CurrentRow> bundledRows() {
        try (var stream = Objects.requireNonNull(ClueViolations.class.getResourceAsStream(RESOURCE), RESOURCE)) {
            return rows(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    static void collect(List<TransportInvariants.CurrentRow> rows, LocationViolations.Components components,
                        TransportInvariants.Findings findings) {
        for (var current : rows) {
            var point = current.row.destination;
            if (components.endsRoutes(point)) continue;
            int component = components.component(point);
            var finding = findings.add("clue", current, point, "The clue step " + LocationViolations.never(point, components));
            Map<String, Object> clue = new LinkedHashMap<>();
            clue.put("id", current.row.label);
            clue.put("category", current.row.section);
            clue.put("source", current.row.fields.get("Source"));
            clue.put("areaTiles", component < 0 ? null : components.size(component));
            finding.put("clue", clue);
        }
    }
}

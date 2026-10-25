package shortestpath.workbench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import shortestpath.transport.ResourceLoader;

/** Offline suggestions, reconciled with the plugin resources in this service. Never changes transports. */
public final class TransportCandidates {
    private static final ObjectMapper JSON = new ObjectMapper();

    private TransportCandidates() { }

    static String resource(String path) {
        try (var stream = Objects.requireNonNull(ResourceLoader.class.getResourceAsStream(path), path)) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    static JsonNode json(String path) {
        try {
            return JSON.readTree(resource(path));
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    public static final class CurrentRow {
        public final String raw;
        public final TransportDiff.Row row;

        CurrentRow(String raw, TransportDiff.Row row) {
            this.raw = raw;
            this.row = row;
        }
    }

    public static final class Reconciliation {
        public final String status;
        public final List<CurrentRow> rows;

        Reconciliation(String status, List<CurrentRow> rows) {
            this.status = status;
            this.rows = rows;
        }
    }

    /** Exact bytes of each data line plus the shared parser's interpretation. Line numbers are references only. */
    static List<CurrentRow> rows(String file, String text) {
        String[] lines = text.split("\r?\n", -1);
        return TransportDiff.parse(file, text).stream().map(row -> new CurrentRow(lines[row.line - 1], row)).collect(Collectors.toList());
    }

    static List<CurrentRow> currentRows(String file, String path) {
        // A later plugin revision can remove an entire file. Its candidates must remain inspectable.
        if (ResourceLoader.class.getResource("/transports/" + file) == null) return List.of();
        return rows(path, resource("/transports/" + file));
    }

    static String label(TransportDiff.Row row) {
        return row.label.isEmpty() ? row.fields.getOrDefault("Display info", "") : row.label;
    }

    static boolean sameEnd(TransportDiff.Point a, TransportDiff.Point b) {
        return a != null && a.equals(b);
    }

    /**
     * A changed row is only a possible correspondence: same label and at least one identical endpoint,
     * or both identical finite endpoints even if the label changed. Teleports also require their label.
     * No distance threshold, object id alone, or current line number can identify a row.
     */
    static Reconciliation reconcile(String original, String suggested, TransportDiff.Row baseline, List<CurrentRow> current) {
        List<CurrentRow> exact = current.stream().filter(row -> row.raw.equals(original)).collect(Collectors.toList());
        if (!exact.isEmpty()) return new Reconciliation(exact.size() == 1 ? "matches_current" : "ambiguous", exact);
        List<CurrentRow> present = current.stream().filter(row -> row.raw.equals(suggested)).collect(Collectors.toList());
        if (!present.isEmpty()) return new Reconciliation(present.size() == 1 ? "already_present" : "ambiguous", present);
        List<CurrentRow> possible = current.stream().filter(value -> {
            TransportDiff.Row row = value.row;
            boolean ends = Objects.equals(baseline.origin, row.origin) && Objects.equals(baseline.destination, row.destination);
            boolean labelled = !label(baseline).isEmpty() && label(baseline).equals(label(row));
            // Two exact finite endpoints can still reveal a metadata/label edit. Teleport destinations
            // are shared by many items/spells, so those also require the label.
            return ends && (baseline.origin != null || labelled)
                || labelled && (sameEnd(baseline.origin, row.origin) || sameEnd(baseline.destination, row.destination));
        }).collect(Collectors.toList());
        return new Reconciliation(possible.isEmpty() ? "missing" : possible.size() > 1 ? "ambiguous" : "diverged", possible);
    }

    static TransportDiff.Row parse(String file, int line, String raw, String header) {
        List<TransportDiff.Row> parsed = TransportDiff.parse(file, header + "\n" + raw + "\n");
        if (parsed.size() != 1) throw new IllegalArgumentException(file + ":" + line + ": expected one transport row");
        TransportDiff.Row row = parsed.get(0);
        if (row.origin == null && row.destination == null) throw new IllegalArgumentException(file + ":" + line + ": no parsed endpoints");
        return new TransportDiff.Row(file, line, "", row.fields);
    }

    static void validateLedger(JsonNode ledger, Set<String> ids) {
        if (!ledger.isObject()) throw new IllegalArgumentException("candidates/reviews.json must be an object keyed by candidate ID");
        ledger.fields().forEachRemaining(entry -> {
            JsonNode decision = entry.getValue();
            if (!ids.contains(entry.getKey())) throw new IllegalArgumentException("Unknown review candidate: " + entry.getKey());
            if (!Set.of("accepted", "rejected", "needs_evidence", "deferred").contains(decision.path("status").asText())
                || !decision.path("explanation").isTextual() || decision.path("explanation").asText().isBlank()) {
                throw new IllegalArgumentException("Review " + entry.getKey() + " needs a valid status and nonempty explanation");
            }
            decision.fieldNames().forEachRemaining(key -> {
                if (!Set.of("status", "explanation", "reference").contains(key) || !decision.path(key).isTextual()) {
                    throw new IllegalArgumentException("Review " + entry.getKey() + ": invalid field " + key);
                }
            });
        });
    }

    /** Separate candidate API model; it is not a GitHub review or a route graph. */
    public static Map<String, Object> bundled(Provenance provenance) {
        JsonNode imported = json("/candidates/catalogue.json"), headers = json("/candidates/headers.json");
        JsonNode ledger = json("/candidates/reviews.json");
        Set<String> ids = new java.util.HashSet<>();
        imported.forEach(candidate -> {
            if (!ids.add(candidate.path("id").asText())) throw new IllegalArgumentException("Duplicate candidate ID");
        });
        validateLedger(ledger, ids);
        Map<String, List<CurrentRow>> current = new HashMap<>();
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (JsonNode candidate : imported) {
            String file = candidate.path("file").asText();
            String path = "src/main/resources/transports/" + file;
            String header = headers.path(file).asText();
            String raw = candidate.path("originalRaw").asText(), suggested = candidate.path("suggestedRaw").asText();
            TransportDiff.Row original = parse(path, candidate.path("originalLine").asInt(), raw, header);
            Map<String, Object> value = JSON.convertValue(candidate, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() { });
            value.put("original", original);
            value.put("suggested", parse(path, original.line, suggested, header));
            value.put("reconciliation", reconcile(raw, suggested, original,
                current.computeIfAbsent(file, key -> currentRows(key, path))));
            JsonNode decision = ledger.get(candidate.path("id").asText());
            value.put("review", decision == null ? Map.of("status", "unreviewed") : decision);
            candidates.add(value);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("candidates", candidates);
        result.put("plugin", provenance.plugin);
        result.put("tooling", provenance.tooling);
        return result;
    }
}

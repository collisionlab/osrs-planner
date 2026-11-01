package shortestpath.workbench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.PluginResources;
import shortestpath.transport.ResourceLoader;
import shortestpath.transport.TransportType;

/**
 * Checks of the bundled plugin data that every transport and location must pass, computed live from
 * the plugin on this service's classpath. Each failure is a finding to fix in the data; nothing here
 * suggests a correction or changes transports.
 */
public final class TransportInvariants {
    private static final ObjectMapper JSON = new ObjectMapper();
    static final String RESOURCES = "src/main/resources";
    static final String SEASONAL = RESOURCES + TransportType.SEASONAL_TRANSPORTS.getResourcePath();
    /** The plugin's location files, as {@link ResourceLoader#destinations()} reads them. */
    static final List<String> LOCATIONS = List.of("/destinations/game_features/altar.tsv", "/destinations/game_features/bank.tsv",
        "/destinations/training/anvil.tsv", "/destinations/shopping/apothecary.tsv");

    private TransportInvariants() { }

    /** A data line exactly as it is in its file, and the shared parser's reading of it. */
    public static final class CurrentRow {
        public final String raw;
        public final TransportDiff.Row row;

        CurrentRow(String raw, TransportDiff.Row row) {
            this.raw = raw;
            this.row = row;
        }
    }

    static String resource(String path) {
        try (var stream = Objects.requireNonNull(ResourceLoader.class.getResourceAsStream(path), path)) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    /** Line numbers are references only. */
    static List<CurrentRow> rows(String file, String text) {
        String[] lines = text.split("\r?\n", -1);
        return TransportDiff.parse(file, text).stream().map(row -> new CurrentRow(lines[row.line - 1], row)).collect(Collectors.toList());
    }

    /** Every non-seasonal transport row of the bundled plugin, file by file. */
    static List<CurrentRow> transportRows() {
        List<CurrentRow> rows = new ArrayList<>();
        for (TransportType type : TransportType.values()) {
            if (!type.hasResourcePath() || type == TransportType.SEASONAL_TRANSPORTS) continue;
            rows.addAll(rows(RESOURCES + type.getResourcePath(), resource(type.getResourcePath())));
        }
        rows.sort(java.util.Comparator.comparing((CurrentRow row) -> row.row.file).thenComparingInt(row -> row.row.line));
        return rows;
    }

    static List<CurrentRow> locationRows() {
        return LOCATIONS.stream().flatMap(path -> rows(RESOURCES + path, resource(path)).stream()).collect(Collectors.toList());
    }

    /**
     * A finding of one invariant about one data line. Its id hashes the invariant, file and exact line,
     * so it survives unrelated insertions; identical lines get -2, -3 suffixes in file order.
     */
    static final class Findings {
        final List<Map<String, Object>> list = new ArrayList<>();
        private final Map<String, Integer> occurrences = new HashMap<>();

        Map<String, Object> add(String invariant, CurrentRow current, TransportDiff.Point focus, String failure) {
            String base = invariant + "-" + hash(invariant + "\u0000" + current.row.file + "\u0000" + current.raw);
            int occurrence = occurrences.merge(base, 1, Integer::sum);
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("id", occurrence == 1 ? base : base + "-" + occurrence);
            value.put("invariant", invariant);
            value.put("file", current.row.file);
            value.put("line", current.row.line);
            value.put("raw", current.raw);
            value.put("row", current.row);
            value.put("focus", focus);
            value.put("failure", failure);
            value.put("review", Map.of("status", "unreviewed"));
            list.add(value);
            return value;
        }
    }

    private static String hash(String text) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder id = new StringBuilder();
            for (int i = 0; i < 12; i++) id.append(String.format("%02x", hash[i]));
            return id.toString();
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    static void validateLedger(JsonNode ledger, Set<String> ids) {
        if (!ledger.isObject()) throw new IllegalArgumentException("invariants/reviews.json must be an object keyed by finding ID");
        ledger.fields().forEachRemaining(entry -> {
            JsonNode decision = entry.getValue();
            if (!ids.contains(entry.getKey())) throw new IllegalArgumentException("Unknown finding in review ledger: " + entry.getKey());
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

    /** All findings of the bundled plugin data, with their review ledger decisions. */
    public static Map<String, Object> bundled(Provenance provenance) {
        CollisionMap collision = new CollisionMap(PluginResources.map());
        Predicate<TransportDiff.Point> walkable = point -> !collision.isBlocked(point.x, point.y, point.plane);
        List<CurrentRow> transports = transportRows();
        Findings findings = new Findings();
        DestinationViolations.collect(transports, walkable, findings);
        EntryViolations.collect(transports, walkable, findings);
        LocationViolations.collect(locationRows(), LocationViolations.Components.bundled(), findings);
        JsonNode ledger;
        try {
            ledger = JSON.readTree(resource("/invariants/reviews.json"));
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
        Set<String> ids = new HashSet<>();
        for (var finding : findings.list) ids.add((String) finding.get("id"));
        validateLedger(ledger, ids);
        for (var finding : findings.list) {
            JsonNode decision = ledger.get((String) finding.get("id"));
            if (decision != null) finding.put("review", decision);
        }
        Map<String, Object> rules = new LinkedHashMap<>();
        rules.put("destination", DestinationViolations.RULE);
        rules.put("entry", EntryViolations.RULE);
        rules.put("location", LocationViolations.RULE);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rules", rules);
        result.put("findings", findings.list);
        result.put("plugin", provenance.plugin);
        result.put("tooling", provenance.tooling);
        return result;
    }
}

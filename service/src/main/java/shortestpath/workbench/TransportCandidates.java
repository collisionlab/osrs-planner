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
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.PluginResources;
import shortestpath.transport.TransportType;

/** Offline suggestions, reconciled with the plugin resources in this service. Never changes transports. */
public final class TransportCandidates {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static final shortestpath.pathfinder.AStarRoutingStaticProvider ROUTING =
        new shortestpath.pathfinder.AStarRoutingStaticProvider(() -> new CollisionMap(PluginResources.map()));

    private TransportCandidates() { }

    static boolean inRoutingComponent(TransportDiff.Point point) {
        if (point == null) return false;
        var routing = ROUTING.get();
        int packed = shortestpath.WorldPointUtil.packWorldPoint(point.x, point.y, point.plane);
        if (routing.searchIndex(packed) >= 0) return true;
        int site = routing.siteIndex(packed);
        return site >= 0 && routing.siteComponents(site).length > 0;
    }

    static String sourcedCategory(TransportDiff.Row proposal, java.util.function.Predicate<TransportDiff.Point> inComponent) {
        return inComponent.test(proposal.origin) && inComponent.test(proposal.destination)
            ? "sourced_transport" : "sourced_transport_outside_routing";
    }

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

    static String geometryKey(TransportDiff.Point origin, TransportDiff.Point destination) {
        return String.valueOf(origin) + ">" + String.valueOf(destination);
    }

    /** Only exact endpoint correspondences for new proposals, never an assertion of equivalent requirements. */
    static Reconciliation reconcileAddition(TransportDiff.Row proposal, List<CurrentRow> current, boolean stop) {
        List<CurrentRow> possible = current.stream().filter(value -> {
            TransportDiff.Row row = value.row;
            return stop ? sameEnd(proposal.origin, row.origin) || sameEnd(proposal.origin, row.destination)
                || sameEnd(proposal.destination, row.origin) || sameEnd(proposal.destination, row.destination)
                : Objects.equals(proposal.origin, row.origin) && Objects.equals(proposal.destination, row.destination);
        }).collect(Collectors.toList());
        return new Reconciliation(possible.isEmpty() ? "proposed_new" : possible.size() == 1 ? "possible_existing" : "ambiguous", possible);
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
        Map<String, List<CurrentRow>> current = new HashMap<>();
        Map<String, List<CurrentRow>> byGeometry = new HashMap<>();
        Map<TransportDiff.Point, List<CurrentRow>> byEndpoint = new HashMap<>();
        for (TransportType type : TransportType.values()) {
            if (!type.hasResourcePath()) continue;
            String resource = type.getResourcePath();
            String file = resource.substring(resource.lastIndexOf('/') + 1);
            List<CurrentRow> rows = current.computeIfAbsent(file, key -> rows("src/main/resources" + resource, resource(resource)));
            for (CurrentRow row : rows) {
                byGeometry.computeIfAbsent(geometryKey(row.row.origin, row.row.destination), key -> new ArrayList<>()).add(row);
                if (row.row.origin != null) byEndpoint.computeIfAbsent(row.row.origin, key -> new ArrayList<>()).add(row);
                if (row.row.destination != null && !row.row.destination.equals(row.row.origin)) {
                    byEndpoint.computeIfAbsent(row.row.destination, key -> new ArrayList<>()).add(row);
                }
            }
        }
        CollisionMap collision = new CollisionMap(PluginResources.map());
        List<CurrentRow> allRows = current.entrySet().stream().sorted(Map.Entry.comparingByKey())
            .flatMap(entry -> entry.getValue().stream()).collect(Collectors.toList());
        List<Map<String, Object>> violations = DestinationViolations.collect(allRows,
            point -> !collision.isBlocked(point.x, point.y, point.plane), provenance);
        violations.forEach(value -> ids.add((String) value.get("id")));
        validateLedger(ledger, ids);
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (JsonNode candidate : imported) {
            Map<String, Object> value = JSON.convertValue(candidate, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() { });
            if (candidate.hasNonNull("originalRaw")) {
                String file = candidate.path("file").asText(), path = "src/main/resources/transports/" + file;
                String header = headers.path(file).asText();
                String raw = candidate.path("originalRaw").asText(), suggested = candidate.path("suggestedRaw").asText();
                TransportDiff.Row original = parse(path, candidate.path("originalLine").asInt(), raw, header);
                value.put("kind", suggested.isEmpty() ? "requirement_note" : "correction");
                value.put("original", original);
                value.put("suggested", suggested.isEmpty() ? null : parse(path, original.line, suggested, header));
                value.put("reconciliation", reconcile(raw, suggested, original,
                    current.computeIfAbsent(file, key -> currentRows(key, path))));
            } else {
                String header = candidate.path("proposalHeader").asText();
                boolean stop = candidate.path("kind").asText().equals("network_stop");
                // Renaming header keys for structured geometry does not change the raw proposal.
                String parsedHeader = stop ? header.replace("Board at", "Origin").replace("Land at", "Destination") : header;
                TransportDiff.Row proposal = parse("bestpath-candidates/" + candidate.path("sourceFile").asText(),
                    candidate.path("sourceLine").asInt(), candidate.path("suggestedRaw").asText(), parsedHeader);
                value.put("original", null);
                value.put("suggested", proposal);
                if (candidate.path("category").asText().equals("sourced_transport")) {
                    value.put("category", sourcedCategory(proposal, TransportCandidates::inRoutingComponent));
                }
                List<CurrentRow> possible;
                if (stop) {
                    Set<CurrentRow> stops = new java.util.LinkedHashSet<>();
                    stops.addAll(byEndpoint.getOrDefault(proposal.origin, List.of()));
                    stops.addAll(byEndpoint.getOrDefault(proposal.destination, List.of()));
                    possible = new ArrayList<>(stops);
                } else possible = byGeometry.getOrDefault(geometryKey(proposal.origin, proposal.destination), List.of());
                value.put("reconciliation", reconcileAddition(proposal, possible, stop));
            }
            JsonNode decision = ledger.get(candidate.path("id").asText());
            value.put("review", decision == null ? Map.of("status", "unreviewed") : decision);
            candidates.add(value);
        }
        for (Map<String, Object> violation : violations) {
            JsonNode decision = ledger.get((String) violation.get("id"));
            if (decision != null) violation.put("review", decision);
            candidates.add(violation);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("candidates", candidates);
        result.put("plugin", provenance.plugin);
        result.put("tooling", provenance.tooling);
        result.put("itemGroups", json("/candidates/item-groups.json"));
        return result;
    }
}

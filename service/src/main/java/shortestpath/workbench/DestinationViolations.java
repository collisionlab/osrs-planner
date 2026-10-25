package shortestpath.workbench;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import shortestpath.transport.TransportType;

/** Current TSV rows whose destination is neither walkable nor an exact transport origin. */
final class DestinationViolations {
    static final String RULE = "Destination must be a walkable tile or the exact origin of a transport.";

    private DestinationViolations() { }

    static List<Map<String, Object>> collect(List<TransportCandidates.CurrentRow> rows,
        Predicate<TransportDiff.Point> walkable, Provenance provenance) {
        // Seasonal rows neither produce review failures nor exempt permanent landing tiles.
        String seasonalFile = "src/main/resources" + TransportType.SEASONAL_TRANSPORTS.getResourcePath();
        rows = rows.stream().filter(current -> !current.row.file.equals(seasonalFile)).collect(Collectors.toList());
        Set<TransportDiff.Point> origins = new HashSet<>();
        for (var current : rows) if (current.row.origin != null) origins.add(current.row.origin);
        List<Map<String, Object>> result = new ArrayList<>();
        Map<String, Integer> occurrences = new HashMap<>();
        for (var current : rows) {
            var row = current.row;
            if (row.destination == null || walkable.test(row.destination) || origins.contains(row.destination)) continue;
            String base = identity(row.file, current.raw);
            int occurrence = occurrences.merge(base, 1, Integer::sum);
            String id = occurrence == 1 ? base : base + "-" + occurrence;
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("id", id);
            value.put("kind", "destination_violation");
            value.put("category", "destination_violation");
            value.put("file", row.file.substring("src/main/resources/transports/".length()));
            value.put("originalLine", row.line);
            value.put("originalRaw", current.raw);
            value.put("original", row);
            value.put("suggestedRaw", "");
            value.put("suggested", null);
            value.put("whatChanges", "Blocked destination with no transport starting on that exact tile. " + RULE);
            value.put("alsoDiffers", "");
            value.put("source", "Checked against the bundled plugin collision and non-seasonal transport resources; no nearby-tile exemptions.");
            value.put("sourceFile", row.file);
            value.put("sourceLine", row.line);
            value.put("sourceRepository", provenance.plugin.repository);
            value.put("sourceCommit", provenance.plugin.rev);
            value.put("upstreamCommit", provenance.plugin.rev);
            value.put("reconciliation", new TransportCandidates.Reconciliation("violation", List.of(current)));
            value.put("review", Map.of("status", "unreviewed"));
            result.add(value);
        }
        return result;
    }

    /** Line numbers and revisions are references; a row's identity survives unrelated insertions. */
    private static String identity(String file, String raw) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest((file + "\u0000" + raw).getBytes(StandardCharsets.UTF_8));
            StringBuilder id = new StringBuilder("destination-");
            for (int i = 0; i < 12; i++) id.append(String.format("%02x", hash[i]));
            return id.toString();
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}

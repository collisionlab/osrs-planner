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
 * Sites from tooling's lists of places players are sent to (clue steps, Forestry calls, shooting
 * stars) that no route can ever end at, by the same rule as {@link LocationViolations}. Each list is
 * one JSON object per line: {@code id}, {@code name}, {@code category}, {@code target},
 * {@code targetSource}.
 */
final class SiteViolations {
    /** A list of sites in tooling's scenarios project, and the invariant it is checked as. */
    enum SiteList {
        CLUE("clue", "clue step", "/scenarios/clue-locations.json"),
        FORESTRY("forestry", "Forestry call location", "/locations/forestry-call-locations.json"),
        STAR("star", "shooting star site", "/locations/shooting-star-sites.json");

        final String invariant;
        /** What one site is, in a sentence: "The clue step …". */
        final String noun;
        final String resource;

        SiteList(String invariant, String noun, String resource) {
            this.invariant = invariant;
            this.noun = noun;
            this.resource = resource;
        }

        /** The list's path in the tooling repository. */
        String file() {
            return "scenarios/src/main/resources" + resource;
        }

        String rule() {
            return "A route can end at every " + noun + ": its tile, or, snapped as the plugin snaps a target, a tile "
                + "within " + TargetReachability.DEFAULT_UNREACHABLE_DISTANCE + " of it, is in a walking area that a chain "
                + "of transports reaches from Lumbridge, ignoring requirements.";
        }
    }

    private static final ObjectMapper JSON = new ObjectMapper();

    private SiteViolations() { }

    /** Each site as a location row: its target is the destination, its id the info, its category the section. */
    static List<TransportInvariants.CurrentRow> rows(SiteList list, String text) {
        String[] lines = text.split("\r?\n", -1);
        List<TransportInvariants.CurrentRow> rows = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (!line.startsWith("{")) continue;
            JsonNode site;
            try {
                site = JSON.readTree(line.endsWith(",") ? line.substring(0, line.length() - 1) : line);
            } catch (IOException error) {
                throw new UncheckedIOException(list.file() + ":" + (i + 1), error);
            }
            JsonNode target = site.path("target");
            Map<String, String> fields = new LinkedHashMap<>();
            fields.put(TransportDiff.DESTINATION, target.get(0).asInt() + " " + target.get(1).asInt() + " " + target.get(2).asInt());
            fields.put(TransportDiff.INFO, site.path("id").asText());
            fields.put("Name", site.path("name").asText());
            fields.put("Source", site.path("targetSource").asText());
            rows.add(new TransportInvariants.CurrentRow(lines[i],
                new TransportDiff.Row(list.file(), i + 1, site.path("category").asText(), fields)));
        }
        return rows;
    }

    static List<TransportInvariants.CurrentRow> bundledRows(SiteList list) {
        try (var stream = Objects.requireNonNull(SiteViolations.class.getResourceAsStream(list.resource), list.resource)) {
            return rows(list, new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    static void collect(SiteList list, List<TransportInvariants.CurrentRow> rows, LocationViolations.Components components,
                        TransportInvariants.Findings findings) {
        for (var current : rows) {
            var point = current.row.destination;
            if (components.endsRoutes(point)) continue;
            int component = components.component(point);
            var finding = findings.add(list.invariant, current, point, "The " + list.noun + " " + LocationViolations.never(point, components));
            Map<String, Object> site = new LinkedHashMap<>();
            site.put("id", current.row.label);
            site.put("name", current.row.fields.get("Name"));
            site.put("category", current.row.section);
            site.put("source", current.row.fields.get("Source"));
            site.put("areaTiles", component < 0 ? null : components.size(component));
            finding.put("site", site);
        }
    }
}

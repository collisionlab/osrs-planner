package shortestpath.workbench;

import java.util.LinkedHashMap;
import java.util.Map;
import shortestpath.candidates.ConnectorSnapshot;
import shortestpath.candidates.Report;
import shortestpath.candidates.Scope;
import shortestpath.candidates.TransportCandidates;
import shortestpath.pathfinder.PluginResources;

/**
 * The transport candidates (tooling's shortestpath.candidates): unreached areas with the connectors
 * and world map links into them, and agility shortcuts with no transport, judged against the plugin
 * on this classpath. A row added to the plugin removes its candidate on the next release.
 */
final class CandidatesView {
    private CandidatesView() { }

    /** The plugin data on the classpath never changes, so the judgement is made once. */
    private static final class Judged {
        static final Report REPORT = TransportCandidates.judge(ConnectorSnapshot.bundled(),
            LocationViolations.bundledWalking(), PluginResources.transports(),
            PluginResources.destinations(), Scope.bundled());
    }

    /** The bundled candidates. */
    static Map<String, Object> bundled(Provenance provenance) {
        Report report = Judged.REPORT;
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rule", report.rule);
        result.put("cache", report.cache);
        result.put("snapshotPlugin", report.snapshotPlugin);
        result.put("extraction", report.extraction);
        result.put("funnel", report.funnel);
        result.put("shortcutMarker", report.shortcutMarker);
        result.put("items", report.items);
        result.put("plugin", provenance.plugin);
        result.put("tooling", provenance.tooling);
        return result;
    }
}

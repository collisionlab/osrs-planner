package shortestpath.workbench;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Properties;

/**
 * Which plugin data this release bundles: the shortest-path commit (and the tooling commit that pins
 * it) its transports and collision come from, recorded when the service is built. The workbench
 * shows it beside the map tiles' own provenance, so a view never implies the two match when they don't.
 */
public final class Provenance {
    /** A repository ({@code owner/name}) at a commit, which is {@code unknown} when the build couldn't tell. */
    public static final class Revision {
        public final String repository, rev;

        Revision(String repository, String rev) {
            this.repository = repository;
            this.rev = rev;
        }
    }

    public final Revision plugin, tooling;

    Provenance(Revision plugin, Revision tooling) {
        this.plugin = plugin;
        this.tooling = tooling;
    }

    /** As the build recorded it, or unknown revisions when it didn't. */
    public static Provenance bundled() {
        Properties properties = new Properties();
        try (InputStream stream = Provenance.class.getResourceAsStream("/workbench-provenance.properties")) {
            if (stream != null) {
                properties.load(stream);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return new Provenance(
            new Revision(properties.getProperty("plugin.repository", "Skretzo/shortest-path"), properties.getProperty("plugin.rev", "unknown")),
            new Revision(properties.getProperty("tooling.repository", "osrs-pathfinding/shortest-path-tooling"), properties.getProperty("tooling.rev", "unknown")));
    }
}

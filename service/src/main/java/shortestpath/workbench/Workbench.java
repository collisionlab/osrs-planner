package shortestpath.workbench;

import io.javalin.Javalin;
import io.javalin.http.Context;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The workbench's API: tools for people working on the plugin's data rather than for players, so
 * its paths (which mirror GitHub's) and JSON may change with the workbench pages, which ship in the
 * same release.
 */
public final class Workbench {
    private static final Pattern PULL_RANGE = Pattern.compile("^([0-9a-f]{40})\\.\\.([0-9a-f]{40})$");
    private static final String IMMUTABLE = "public, max-age=31536000, immutable";

    private Workbench() { }

    /** Configured from the environment: {@code WORKBENCH_REPOS} (comma separated) and {@code WORKBENCH_CACHE}. */
    public static Reviews fromEnvironment() {
        Map<String, String> env = System.getenv();
        List<String> repositories = List.of(env.getOrDefault("WORKBENCH_REPOS", "Skretzo/shortest-path").split(","));
        Path cache = Path.of(env.getOrDefault("WORKBENCH_CACHE", System.getProperty("java.io.tmpdir") + "/workbench"));
        return new Reviews(repositories, cache, "https://github.com/");
    }

    public static void routes(Javalin app, Reviews reviews) {
        String github = "/workbench/v1/github/{owner}/{repo}";
        // The review a link names: never changes, so it is cached for good everywhere.
        app.get(github + "/pull/{number}/files/{range}", ctx -> {
            Matcher range = PULL_RANGE.matcher(ctx.pathParam("range"));
            if (!range.matches()) {
                throw new IllegalArgumentException("expected <base commit>..<head commit>");
            }
            ctx.header("Cache-Control", IMMUTABLE).json(reviews.pull(repository(ctx, reviews), number(ctx), range.group(1), range.group(2)));
        });
        // The pull request as it is now; the page swaps to the immutable range it names.
        app.get(github + "/pull/{number}", ctx -> {
            String repository = repository(ctx, reviews);
            Reviews.Heads heads = reviews.heads(repository, number(ctx));
            ctx.header("Cache-Control", "public, max-age=60").json(reviews.pull(repository, number(ctx), heads.base, heads.head));
        });
        // For "a newer push exists".
        app.get(github + "/pull/{number}/heads", ctx ->
            ctx.header("Cache-Control", "public, max-age=60").json(reviews.heads(repository(ctx, reviews), number(ctx))));
        app.get(github + "/compare/<range>", ctx -> {
            String[] ends = ctx.pathParam("range").split("\\.\\.\\.", -1);
            if (ends.length != 2) {
                throw new IllegalArgumentException("expected <base>...<head>");
            }
            boolean pinned = GitSource.SHA.matcher(ends[0]).matches() && GitSource.SHA.matcher(ends[1]).matches();
            ctx.header("Cache-Control", pinned ? IMMUTABLE : "public, max-age=60").json(reviews.compare(repository(ctx, reviews), ends[0], ends[1]));
        });
    }

    private static String repository(Context ctx, Reviews reviews) {
        String repository = reviews.repository(ctx.pathParam("owner"), ctx.pathParam("repo"));
        if (repository == null) {
            throw new Reviews.NotServed(ctx.pathParam("owner") + "/" + ctx.pathParam("repo"));
        }
        return repository;
    }

    private static int number(Context ctx) {
        String number = ctx.pathParam("number");
        if (!number.matches("^[1-9]\\d{0,6}$")) {
            throw new IllegalArgumentException("not a pull request number: " + number);
        }
        return Integer.parseInt(number);
    }
}

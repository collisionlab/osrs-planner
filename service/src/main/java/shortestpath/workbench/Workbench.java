package shortestpath.workbench;

import io.javalin.Javalin;
import io.javalin.http.Context;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The workbench's API: tools for people working on the plugin's data rather than for players, so
 * its paths (which mirror GitHub's) and JSON may change with the workbench pages, which ship in the
 * same release.
 */
public final class Workbench {
    private static final Pattern PULL_RANGE = Pattern.compile("^([0-9a-f]{40})\\.\\.([0-9a-f]{40})$");
    private static final String STARTED = "workbench.started";
    private static final String IMMUTABLE = "public, max-age=31536000, immutable";

    private Workbench() { }

    /** How often the open pull requests are listed again. */
    public static final Duration REFRESH = Duration.ofMinutes(5);

    /**
     * Configured from the environment: {@code WORKBENCH_REPOS} (comma separated), {@code WORKBENCH_CACHE},
     * and optionally {@code GITHUB_TOKEN}, which only raises GitHub's rate limit for listing pull requests.
     */
    public static Reviews fromEnvironment() {
        Map<String, String> env = System.getenv();
        List<String> repositories = List.of(env.getOrDefault("WORKBENCH_REPOS", "Skretzo/shortest-path").split(","));
        Path cache = Path.of(env.getOrDefault("WORKBENCH_CACHE", System.getProperty("java.io.tmpdir") + "/workbench"));
        return new Reviews(repositories, cache, "https://github.com/", "https://api.github.com/", env.get("GITHUB_TOKEN"));
    }

    /** The transport explorer's routes: the bundled plugin's effective transports, a view at a time. */
    public static void transportRoutes(Javalin app, Supplier<TransportCatalog> catalog, Provenance provenance) {
        // Read-only, local resources only. Reconciliation is against the plugin on this classpath.
        app.get("/workbench/v1/candidates", ctx -> ctx.header("Cache-Control", "no-cache")
            .json(TransportCandidates.bundled(provenance)));
        String transports = "/workbench/v1/transports";
        String cache = "public, max-age=300";
        app.get(transports + "/meta", ctx -> {
            TransportCatalog loaded = catalog.get();
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("apiVersion", "workbench-transports-v1");
            meta.put("plugin", provenance.plugin);
            meta.put("tooling", provenance.tooling);
            meta.put("total", loaded.size());
            meta.put("viewLimit", TransportCatalog.VIEW_LIMIT);
            meta.put("types", loaded.types());
            ctx.header("Cache-Control", cache).json(meta);
        });
        app.get(transports + "/networks", ctx -> ctx.header("Cache-Control", cache).json(catalog.get().networks()));
        app.get(transports + "/search", ctx ->
            ctx.header("Cache-Control", cache).json(catalog.get().search(Objects.toString(ctx.queryParam("q"), ""), types(ctx))));
        // Transports with an end in the view: ?view=plane,x1,y1,x2,y2;... (a box per area drawn).
        app.get(transports, ctx -> ctx.header("Cache-Control", cache)
            .json(catalog.get().view(boxes(ctx.queryParam("view")), types(ctx), TransportCatalog.VIEW_LIMIT)));
        app.get(transports + "/{id}", ctx -> {
            String id = ctx.pathParam("id");
            if (!id.matches("^[0-9a-f]{12}(-\\d{1,4})?$")) {
                throw new IllegalArgumentException("not a transport id: " + id);
            }
            ctx.header("Cache-Control", cache).json(catalog.get().detail(id));
        });
    }

    /**
     * The benchmark cases of the bundled tooling ({@link Benchmarks}): the list, and a run of one, planned on
     * demand and kept. A run waits for the one benchmark worker; with too many waiting it answers 503.
     */
    public static void benchmarkRoutes(Javalin app, Supplier<Benchmarks> benchmarks) {
        app.get("/workbench/v1/benchmarks", ctx -> ctx.header("Cache-Control", "public, max-age=300")
            .json(benchmarks.get().index()));
        app.get("/workbench/v1/benchmarks/run", ctx -> {
            String suite = ctx.queryParam("suite"), name = ctx.queryParam("name");
            if (suite == null || name == null) throw new IllegalArgumentException("expected suite= and name=");
            ctx.future(() -> benchmarks.get().run(suite, name)
                .orTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
                .thenAccept(result -> ctx.header("Cache-Control", "no-cache").json(result)));
        });
    }

    /** The banks of the bundled plugin, all at once (there are about a hundred), for the explorer's banks layer. */
    public static void bankRoutes(Javalin app, Supplier<BankCatalog> catalog, Provenance provenance) {
        app.get("/workbench/v1/banks", ctx -> {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("plugin", provenance.plugin);
            body.put("banks", catalog.get().banks());
            ctx.header("Cache-Control", "public, max-age=300").json(body);
        });
    }

    /**
     * The inset investigation's topology report from shortest-path-tooling, served as it was made:
     * the file {@code WORKBENCH_TOPOLOGY} names, else {@code workbench-topology.json} on the
     * classpath. The page checks it; without one it answers 404 and the page says so, rather than
     * working anything out itself.
     */
    public static void topologyRoutes(Javalin app, Supplier<byte[]> report) {
        app.get("/workbench/v1/topology", ctx -> {
            byte[] body = report.get();
            if (body == null) {
                throw new Reviews.NotFound("this build has no topology report from shortest-path-tooling");
            }
            ctx.header("Cache-Control", "public, max-age=300").contentType("application/json").result(body);
        });
    }

    /** The topology report this service serves, or null (see {@link #topologyRoutes}). */
    public static byte[] topologyReport(String path) {
        try {
            if (path != null && !path.isBlank()) {
                return java.nio.file.Files.readAllBytes(Path.of(path));
            }
            try (var stream = Workbench.class.getResourceAsStream("/workbench-topology.json")) {
                return stream == null ? null : stream.readAllBytes();
            }
        } catch (java.io.IOException error) {
            throw new java.io.UncheckedIOException(error);
        }
    }

    /** At most this many boxes a view, each at most this many tiles a side. */
    static final int MAX_BOXES = 24, MAX_BOX_SIDE = 4096;

    static List<TransportCatalog.Box> boxes(String view) {
        if (view == null || view.isBlank()) {
            throw new IllegalArgumentException("expected view=plane,x1,y1,x2,y2;...");
        }
        List<TransportCatalog.Box> boxes = new ArrayList<>();
        for (String part : view.split(";")) {
            String[] numbers = part.split(",");
            if (numbers.length != 5 || !part.matches("^-?\\d{1,6}(,-?\\d{1,6}){4}$")) {
                throw new IllegalArgumentException("not a box: " + part);
            }
            int[] n = Arrays.stream(numbers).mapToInt(Integer::parseInt).toArray();
            TransportCatalog.Box box = new TransportCatalog.Box(n[0], n[1], n[2], n[3], n[4]);
            if (box.plane < 0 || box.plane > 3 || box.x2 - box.x1 > MAX_BOX_SIDE || box.y2 - box.y1 > MAX_BOX_SIDE) {
                throw new IllegalArgumentException("box out of range: " + part);
            }
            boxes.add(box);
        }
        if (boxes.size() > MAX_BOXES) {
            throw new IllegalArgumentException("at most " + MAX_BOXES + " boxes");
        }
        return boxes;
    }

    private static Set<String> types(Context ctx) {
        String types = ctx.queryParam("types");
        if (types == null || types.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(types.split(",")).map(String::trim).filter(type -> type.matches("^[A-Z_]{1,40}$")).collect(Collectors.toSet());
    }

    public static void routes(Javalin app, Reviews reviews) {
        String github = "/workbench/v1/github/{owner}/{repo}";
        // Each request timed by route and status, errors included (after-handlers run after exception mapping).
        app.before("/workbench/*", ctx -> ctx.attribute(STARTED, System.nanoTime()));
        app.after("/workbench/*", ctx -> {
            Long started = ctx.attribute(STARTED);
            if (started != null) {
                reviews.metrics().request(route(ctx.endpointHandlerPath()), ctx.statusCode(), System.nanoTime() - started);
            }
        });
        // The open pull requests that change transports, listed again every few minutes.
        app.get(github + "/pulls", ctx ->
            ctx.header("Cache-Control", "public, max-age=60").json(reviews.openPulls(repository(ctx, reviews))));
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

    /** A short name for a route's path template, for metrics. */
    static String route(String path) {
        if (path.endsWith("/files/{range}")) {
            return "files";
        } else if (path.endsWith("/pull/{number}")) {
            return "pull";
        } else if (path.endsWith("/heads")) {
            return "heads";
        } else if (path.endsWith("/pulls")) {
            return "pulls";
        } else if (path.contains("/compare/")) {
            return "compare";
        } else if (path.endsWith("/topology")) {
            return "topology";
        } else if (path.contains("/transports")) {
            return path.endsWith("/transports") ? "transports" : path.endsWith("{id}") ? "transport" : path.substring(path.lastIndexOf('/') + 1);
        }
        return "other";
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

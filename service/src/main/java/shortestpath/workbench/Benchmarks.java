package shortestpath.workbench;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;
import shortestpath.WorldPointUtil;
import shortestpath.pathfinder.AStarPathfinder;
import shortestpath.pathfinder.PathStep;
import shortestpath.pathfinder.PathfinderResult;
import shortestpath.pathfinder.astar.RoutingStatic;
import shortestpath.routeapi.RouteApi;
import shortestpath.routeapi.RoutePlans;
import shortestpath.scenarios.Observation;
import shortestpath.scenarios.Scenario;
import shortestpath.scenarios.ScenarioRunner;
import shortestpath.scenarios.Suites;
import shortestpath.transport.Transport;

/**
 * The benchmark cases of the bundled shortest-path-tooling (every scenario of every suite: its
 * regressions, routes, clue locations and canonical corpus) and runs of them on demand, through
 * tooling's own {@link ScenarioRunner}, on the A* backend with this service's static routing data. A
 * run is what tooling's route CLI and dashboard would see for the case, so its result and check are
 * theirs; the time is this service's.
 */
public final class Benchmarks {
    /** Runs waiting for the worker; beyond this a run is refused as busy. */
    static final int QUEUE = 8;

    private final ScenarioRunner runner;
    private final Provenance provenance;
    private final IntFunction<String> itemName;
    // One run at a time: they take a few milliseconds to a few seconds, and the route service's workers come first
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(QUEUE), runnable -> {
            Thread thread = new Thread(runnable, "workbench-benchmarks");
            thread.setDaemon(true);
            return thread;
        });
    private final Cache<String, Map<String, Object>> runs = Caffeine.newBuilder().maximumSize(512).build();
    private volatile Loaded loaded;

    /** @param itemName names an item id in the route plan's requirements, as the route API does */
    public Benchmarks(RoutingStatic routingStatic, Provenance provenance, IntFunction<String> itemName) {
        this.runner = new ScenarioRunner(ScenarioRunner.AStarSession.COLD, routingStatic);
        this.provenance = provenance;
        this.itemName = itemName;
    }

    /** Every suite's scenarios, loaded once. */
    private static final class Loaded {
        final Map<String, List<Scenario>> suites = new LinkedHashMap<>();
        final Map<String, Object> index = new LinkedHashMap<>();
    }

    private Loaded loaded() {
        Loaded current = loaded;
        if (current == null) {
            synchronized (this) {
                if (loaded == null) loaded = load();
                current = loaded;
            }
        }
        return current;
    }

    private Loaded load() {
        Loaded result = new Loaded();
        List<Map<String, Object>> suites = new ArrayList<>();
        List<Map<String, Object>> scenarios = new ArrayList<>();
        for (String suite : Suites.names()) {
            List<Scenario> loaded;
            try {
                loaded = Suites.load(suite);
            } catch (IOException error) {
                throw new UncheckedIOException(error);
            }
            result.suites.put(suite, loaded);
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("name", suite);
            summary.put("scenarios", loaded.size());
            suites.add(summary);
            for (Scenario scenario : loaded) {
                scenarios.add(entry(suite, scenario));
            }
        }
        result.index.put("apiVersion", "workbench-benchmarks-v1");
        result.index.put("plugin", provenance.plugin);
        result.index.put("tooling", provenance.tooling);
        result.index.put("backend", "astar");
        result.index.put("suites", suites);
        result.index.put("scenarios", scenarios);
        return result;
    }

    private static Map<String, Object> entry(String suite, Scenario scenario) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("suite", suite);
        entry.put("name", scenario.getName());
        entry.put("category", scenario.getCategory());
        entry.put("profile", scenario.getProfile().name());
        entry.put("tiers", scenario.getTiers().stream().sorted().toArray());
        if (scenario.getDescription() != null) entry.put("description", scenario.getDescription());
        entry.put("start", point(scenario.getRouteStart()));
        entry.put("target", point(scenario.getTarget()));
        entry.put("allowTransports", scenario.isAllowTransports());
        entry.put("expectedReachable", scenario.isExpectedReachable());
        scenario.getMinimumLength().ifPresent(length -> entry.put("minimumLength", length));
        scenario.getExpectedLength().ifPresent(length -> entry.put("expectedLength", length));
        return entry;
    }

    /** The benchmark cases: {@code {suites: [{name, scenarios}], scenarios: [{suite, name, category, ...}]}}. */
    public Map<String, Object> index() {
        return loaded().index;
    }

    /** Thrown for a run refused because runs are already queued. */
    public static final class Busy extends RuntimeException {
        Busy() {
            super("benchmark runs are busy", null, false, false);
        }
    }

    /**
     * Runs scenario {@code name} of {@code suite} once, or answers the run already made: the service's
     * engine and data don't change while it runs, so neither does the result.
     */
    public CompletableFuture<Map<String, Object>> run(String suite, String name) {
        List<Scenario> scenarios = loaded().suites.get(suite);
        if (scenarios == null) throw new Reviews.NotFound("no benchmark suite " + suite);
        Scenario scenario = scenarios.stream().filter(candidate -> candidate.getName().equals(name)).findFirst()
            .orElseThrow(() -> new Reviews.NotFound("no benchmark " + name + " in " + suite));
        String key = suite + '\n' + name;
        Map<String, Object> cached = runs.getIfPresent(key);
        if (cached != null) return CompletableFuture.completedFuture(cached);
        try {
            return CompletableFuture.supplyAsync(() -> {
                // Compiled and run on the same thread, which the compiled config takes as the client thread
                Map<String, Object> result = result(suite, runner.run(scenario), itemName);
                runs.put(key, result);
                return result;
            }, worker);
        } catch (java.util.concurrent.RejectedExecutionException busy) {
            throw new Busy();
        }
    }

    static Map<String, Object> result(String suite, Observation observation, IntFunction<String> itemName) {
        Scenario scenario = observation.getScenario();
        PathfinderResult result = observation.getResult();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("suite", suite);
        body.put("name", scenario.getName());
        body.put("backend", observation.getBackend().id());
        body.put("reached", observation.isReached());
        body.put("termination", result.getTerminationReason() == null ? null : result.getTerminationReason().name());
        body.put("cost", observation.getCost());
        body.put("pathLength", observation.getPathLength());
        Observation.Assertion check = observation.check();
        Map<String, Object> verdict = new LinkedHashMap<>();
        verdict.put("passed", check.passed);
        verdict.put("message", check.message);
        body.put("check", verdict);
        body.put("totalMs", millis(observation.getTotalNanos()));
        AStarPathfinder search = observation.getAStar();
        if (search != null) {
            Map<String, Object> phases = new LinkedHashMap<>();
            phases.put("accountPrepare", millis(search.getAccountPrepareNanos()));
            phases.put("graphPrepare", millis(search.getGraphPrepareNanos()));
            phases.put("reverseSearch", millis(search.getReverseSearchNanos()));
            phases.put("heuristicPrepare", millis(search.getHeuristicPrepareNanos()));
            phases.put("forwardSearch", millis(search.getForwardSearchNanos()));
            phases.put("walkCanonicalize", millis(search.getWalkCanonicalizeNanos()));
            phases.put("walkRewrite", millis(search.getWalkRewriteNanos()));
            body.put("phasesMs", phases);
            body.put("statesPopped", search.getAStarStats() == null ? null : search.getAStarStats().statesPopped());
        }
        List<int[]> path = new ArrayList<>();
        List<Map<String, Object>> transports = new ArrayList<>();
        List<PathStep> steps = result.getPathSteps();
        for (int i = 0; i < steps.size(); i++) {
            PathStep step = steps.get(i);
            int packed = step.getPackedPosition();
            path.add(new int[] {WorldPointUtil.unpackWorldX(packed), WorldPointUtil.unpackWorldY(packed),
                WorldPointUtil.unpackWorldPlane(packed), step.getBankVisitState().ordinal()});
            Transport transport = step.getTransport();
            if (transport != null) {
                Map<String, Object> used = new LinkedHashMap<>();
                used.put("step", i);
                used.put("type", transport.getType().name());
                if (transport.getDisplayInfo() != null) used.put("info", transport.getDisplayInfo());
                if (transport.getObjectInfo() != null) used.put("object", transport.getObjectInfo());
                used.put("duration", transport.getDuration());
                transports.add(used);
            }
        }
        body.put("path", path);
        body.put("transports", transports);
        // The route as the planner draws one, its steps grouped into walks and transports like the route API's
        body.put("plan", RoutePlans.plan(location(scenario.getRouteStart(), "Start"), location(scenario.getTarget(), "Target"),
            result, observation.getAccount().getConfig(), itemName));
        return body;
    }

    private static RouteApi.Location location(int packed, String name) {
        RouteApi.Location location = new RouteApi.Location();
        location.name = name;
        location.coordinate = new RouteApi.WorldPoint(WorldPointUtil.unpackWorldX(packed), WorldPointUtil.unpackWorldY(packed),
            WorldPointUtil.unpackWorldPlane(packed));
        return location;
    }

    private static int[] point(int packed) {
        return new int[] {WorldPointUtil.unpackWorldX(packed), WorldPointUtil.unpackWorldY(packed),
            WorldPointUtil.unpackWorldPlane(packed)};
    }

    private static double millis(long nanos) {
        return Math.round(nanos / 10_000.0) / 100.0;
    }
}

package shortestpath.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import shortestpath.accounts.Account;
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.ExactPathfinder;
import shortestpath.pathfinder.ExactRoutingStaticProvider;
import shortestpath.pathfinder.Pathfinder;
import shortestpath.pathfinder.PathfinderBackend;
import shortestpath.pathfinder.PathfinderResult;
import shortestpath.pathfinder.PluginResources;
import shortestpath.pathfinder.exact.ExactForwardSearch;
import shortestpath.pathfinder.exact.ExactRoutingSession;
import shortestpath.pathfinder.exact.RoutingStatic;
import shortestpath.profiles.AccountPathfinderConfig;
import shortestpath.profiles.CompiledAccount;
import shortestpath.profiles.PluginSettings;
import shortestpath.routeapi.PlannerSettings;
import shortestpath.routeapi.RouteApi;
import shortestpath.routeapi.RoutePlans;

/**
 * Plans routes on the backend the settings choose, caching each account's config and exact search
 * session, and finished plans.
 */
final class RoutingEngine {
    private final ObjectMapper mapper;
    private final RoutingStatic routingStatic;
    private final Cache<String, AccountSession> accounts = Caffeine.newBuilder().maximumSize(32).build();
    private final Cache<String, RouteApi.RoutePlan> routes = Caffeine.newBuilder().maximumSize(256).build();

    RoutingEngine(ObjectMapper mapper) {
        this.mapper = mapper;
        this.routingStatic = new ExactRoutingStaticProvider(() -> new CollisionMap(PluginResources.map())).get();
    }

    RouteApi.RoutePlan route(RouteApi.RouteRequest request) {
        return routeWithStats(request).plan;
    }

    /** A plan and how it was found: which caches it hit and the search's own counters and timings. */
    static final class Routed {
        final RouteApi.RoutePlan plan;
        final Map<String, Object> stats;

        private Routed(RouteApi.RoutePlan plan, Map<String, Object> stats) {
            this.plan = plan;
            this.stats = stats;
        }
    }

    Routed routeWithStats(RouteApi.RouteRequest request) {
        Map<String, Object> stats = new LinkedHashMap<>();
        String accountKey = json(request.account) + json(request.settings);
        int start = RoutePlans.packed(request.start.coordinate);
        int target = RoutePlans.packed(request.destination.coordinate);
        String routeKey = accountKey + '|' + start + '|' + target;
        RouteApi.RoutePlan cached = routes.getIfPresent(routeKey);
        stats.put("routeCacheHit", cached != null);
        if (cached != null) {
            return new Routed(cached, stats);
        }

        long compileStart = System.nanoTime();
        boolean[] compiled = {false};
        AccountSession account = accounts.get(accountKey, ignored -> {
            compiled[0] = true;
            return new AccountSession(request);
        });
        stats.put("accountCacheHit", !compiled[0]);
        if (compiled[0]) {
            stats.put("accountCompileMs", millis(System.nanoTime() - compileStart));
        }
        stats.put("backend", account.backend.name());
        PathfinderResult result;
        if (account.backend == PathfinderBackend.LEGACY) {
            Pathfinder pathfinder = new Pathfinder(account.config, start, Set.of(target));
            pathfinder.run();
            result = pathfinder.getResult();
        } else {
            ExactPathfinder pathfinder = new ExactPathfinder(account.config, routingStatic, account.session,
                start, Set.of(target), null, account.config.getExactHeuristicWeight());
            pathfinder.run();
            result = pathfinder.getResult();
            exactStats(pathfinder, stats);
        }
        if (result == null) {
            throw new IllegalStateException("the pathfinder returned no result");
        }
        stats.put("termination", result.getTerminationReason() == null ? null : result.getTerminationReason().name());
        stats.put("searchMs", millis(result.getElapsedNanos()));
        stats.put("nodesChecked", result.getNodesChecked());
        stats.put("transportsChecked", result.getTransportsChecked());
        stats.put("pathSteps", result.getPathSteps() == null ? 0 : result.getPathSteps().size());

        RouteApi.RoutePlan plan = RoutePlans.plan(request.start, request.destination, result, account.config,
            account.backend, ItemCatalog::name);
        routes.put(routeKey, plan);
        return new Routed(plan, stats);
    }

    /** The exact search's phase timings and the forward search counters most useful for tuning. */
    private static void exactStats(ExactPathfinder pathfinder, Map<String, Object> stats) {
        stats.put("graphReused", pathfinder.isGraphReused());
        stats.put("targetReused", pathfinder.isTargetReused());
        Map<String, Object> phases = new LinkedHashMap<>();
        phases.put("accountPrepare", millis(pathfinder.getAccountPrepareNanos()));
        phases.put("routingStatic", millis(pathfinder.getRoutingStaticNanos()));
        phases.put("graphPrepare", millis(pathfinder.getGraphPrepareNanos()));
        phases.put("reverseSearch", millis(pathfinder.getReverseSearchNanos()));
        phases.put("heuristicPrepare", millis(pathfinder.getHeuristicPrepareNanos()));
        phases.put("forwardSearch", millis(pathfinder.getForwardSearchNanos()));
        phases.put("walkCanonicalize", millis(pathfinder.getWalkCanonicalizeNanos()));
        phases.put("walkRewrite", millis(pathfinder.getWalkRewriteNanos()));
        stats.put("phasesMs", phases);
        ExactForwardSearch.Counters counters = pathfinder.getExactStats();
        if (counters != null) {
            Map<String, Object> forward = new LinkedHashMap<>();
            forward.put("statesPopped", counters.statesPopped());
            forward.put("staleEntries", counters.staleEntries());
            forward.put("pqPushes", counters.pqPushes());
            forward.put("maxQueueSize", counters.maxQueueSize());
            forward.put("uniqueStatesReached", counters.uniqueStatesReached());
            forward.put("walkingRelaxations", counters.walkingRelaxations());
            forward.put("transportRelaxations", counters.transportRelaxations());
            forward.put("transportCandidates", counters.transportCandidates());
            forward.put("heuristicEvaluations", counters.heuristicEvaluations());
            forward.put("heuristicCacheHits", counters.heuristicCacheHits());
            forward.put("heuristicUnreachable", counters.heuristicUnreachable());
            forward.put("rekeys", counters.rekeys());
            stats.put("forward", forward);
        }
    }

    private static double millis(long nanos) {
        return Math.round(nanos / 10_000.0) / 100.0;
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("invalid route request", error);
        }
    }

    /** A request's account and settings compiled once, and the exact search state its routes share. */
    private static final class AccountSession {
        private final AccountPathfinderConfig config;
        private final PathfinderBackend backend;
        private final ExactRoutingSession session = new ExactRoutingSession();

        private AccountSession(RouteApi.RouteRequest request) {
            Account account = request.account.toAccount();
            PluginSettings settings = PlannerSettings.fromJson(request.settings);
            if (account.poh() != null) {
                settings.applyPoh(account.poh(), true);
            }
            config = CompiledAccount.of(account, settings).getConfig();
            backend = settings.pathfinderBackend();
        }
    }
}

package shortestpath.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.fasterxml.jackson.databind.json.JsonMapper;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.staticfiles.Location;
import io.javalin.json.JavalinJackson;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.Timer;
import io.micrometer.prometheusmetrics.PrometheusConfig;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.LoggerFactory;
import shortestpath.accounts.canonical.CanonicalAccounts;
import shortestpath.routeapi.AccountJson;
import shortestpath.routeapi.Catalog;
import shortestpath.routeapi.RouteApi;
import shortestpath.workbench.Reviews;
import shortestpath.workbench.Workbench;

/**
 * The route service's HTTP API: {@code POST /v1/route}, {@code GET /v1/presets}, {@code GET /v1/catalog},
 * {@code GET /v1/items}, health and metrics.
 */
public final class ServiceMain {
    /** The canonical accounts the planner offers as starting points. */
    private static final List<RouteApi.Preset> PRESETS = List.of(
        preset("early", "Early game"), preset("mid", "Mid game"), preset("end", "End game"), preset("maxed", "Maxed"));

    private ServiceMain() { }

    private static RouteApi.Preset preset(String id, String name) {
        return new RouteApi.Preset(id, name, AccountJson.of(name, CanonicalAccounts.account(id)));
    }

    public static void main(String[] args) {
        ObjectMapper mapper = JsonMapper.builder().findAndAddModules().build();
        RoutingEngine engine = new RoutingEngine(mapper);
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        Reviews reviews = Workbench.fromEnvironment();
        app(mapper, engine, reviews).start(port);
        reviews.start(Workbench.REFRESH);
    }

    static Javalin app(ObjectMapper mapper, RoutingEngine engine) {
        return app(mapper, engine, Workbench.fromEnvironment());
    }

    static Javalin app(ObjectMapper mapper, RoutingEngine engine, Reviews reviews) {
        SchemaValidator validator = new SchemaValidator();
        PrometheusMeterRegistry metrics = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        Counter rejected = Counter.builder("route_requests_rejected_total").register(metrics);
        RouteLog routeLog = new RouteLog(mapper, PRESETS);
        int workers = Math.max(2, Math.min(8, Runtime.getRuntime().availableProcessors()));
        ThreadPoolExecutor executor = new ThreadPoolExecutor(workers, workers, 0, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(RouteAdmission.QUEUE), new ThreadPoolExecutor.AbortPolicy());

        Javalin app = Javalin.create(config -> {
            config.jsonMapper(new JavalinJackson(mapper));
            // The release image serves the built frontend too, so one release switches both.
            String frontend = System.getenv("FRONTEND_DIR");
            if (frontend != null) {
                config.staticFiles.add(files -> {
                    files.hostedPath = "/assets";
                    files.directory = frontend + "/assets";
                    files.location = Location.EXTERNAL;
                    files.headers = Map.of("Cache-Control", "public, max-age=31536000, immutable");
                });
                config.staticFiles.add(files -> {
                    files.hostedPath = "/";
                    files.directory = frontend;
                    files.location = Location.EXTERNAL;
                    files.headers = Map.of("Cache-Control", "no-cache");
                });
                config.spaRoot.addFile("/", frontend + "/index.html", Location.EXTERNAL);
            }
        });
        app.events(events -> events.serverStopping(executor::shutdown));
        app.before(ctx -> {
            String requestId = ctx.header("X-Request-ID");
            if (requestId == null || requestId.isBlank()) {
                requestId = UUID.randomUUID().toString();
            }
            ctx.attribute("requestId", requestId);
            ctx.header("X-Request-ID", requestId);
        });
        app.get("/live", ctx -> ctx.json(Map.of("status", "ok")));
        app.get("/ready", ctx -> ctx.json(Map.of("status", "ready")));
        // The frontend compares this with the release it was loaded from and offers a reload.
        String release = System.getenv().getOrDefault("RELEASE", "dev");
        app.get("/version", ctx -> {
            ctx.header("Cache-Control", "no-cache");
            ctx.json(Map.of("release", release));
        });
        app.get("/metrics", ctx -> ctx.contentType("text/plain; version=0.0.4").result(metrics.scrape()));
        app.get("/v1/items", ctx -> ctx.json(ItemCatalog.find(ctx.queryParam("q"), ctx.queryParam("ids"))));
        Catalog catalog = new Catalog();
        app.get("/v1/catalog", ctx -> ctx.json(catalog));
        app.get("/v1/presets", ctx -> ctx.json(PRESETS));
        app.get("/v1/plane-links", ctx -> ctx.header("Cache-Control", "public, max-age=3600").json(PlaneLinks.LINKS));
        app.post("/v1/route", ctx -> {
            JsonNode body = mapper.readTree(ctx.body());
            validator.validate(body);
            RouteApi.RouteRequest request = mapper.treeToValue(body, RouteApi.RouteRequest.class);
            long received = System.nanoTime();
            long[] started = {-1};
            boolean drag = "drag".equals(ctx.header("X-Route-Trigger"));
            try {
                if (!RouteAdmission.admit(drag, executor.getQueue().size(), workers)) {
                    throw new RejectedExecutionException("drag preview while busy");
                }
                CompletableFuture<Void> future = CompletableFuture.supplyAsync(() -> {
                    started[0] = System.nanoTime();
                    if (!RouteAdmission.fresh(drag, started[0] - received)) {
                        throw new RouteAdmission.Stale();
                    }
                    return engine.routeWithStats(request);
                }, executor)
                    .orTimeout(30, TimeUnit.SECONDS)
                    .handle((routed, error) -> {
                        String outcome;
                        if (error == null) {
                            ctx.json(routed.plan);
                            outcome = routed.plan.reachable ? "reachable" : "unreachable";
                            record(metrics, routed);
                        } else if (cause(error) instanceof RouteAdmission.Stale) {
                            rejected.increment();
                            error(ctx, 503, "route service is busy");
                            outcome = "busy";
                        } else if (cause(error) instanceof TimeoutException) {
                            error(ctx, 504, "route calculation timed out");
                            outcome = "timeout";
                        } else if (cause(error) instanceof IllegalArgumentException) {
                            error(ctx, 400, cause(error).getMessage());
                            outcome = "invalid";
                        } else {
                            LoggerFactory.getLogger(ServiceMain.class).error("route {} failed", ctx.attribute("requestId"), cause(error));
                            error(ctx, 500, "route calculation failed");
                            outcome = "error";
                        }
                        finish(metrics, routeLog, ctx, request, outcome, routed, received, started[0]);
                        return null;
                    });
                ctx.future(() -> future);
            } catch (RejectedExecutionException busy) {
                rejected.increment();
                error(ctx, 503, "route service is busy");
                finish(metrics, routeLog, ctx, request, "busy", null, received, -1);
            }
        });
        Workbench.routes(app, reviews);
        app.exception(Reviews.NotServed.class, (error, ctx) -> error(ctx, 404, error.getMessage()));
        app.exception(Reviews.NotFound.class, (error, ctx) -> error(ctx, 404, error.getMessage()));
        app.exception(IllegalArgumentException.class, (error, ctx) -> error(ctx, 400, error.getMessage()));
        app.exception(InvalidFormatException.class, (error, ctx) -> error(ctx, 400,
            "invalid value " + error.getValue() + " at " + path(error)));
        app.exception(JsonProcessingException.class, (error, ctx) -> error(ctx, 400, "request body is not valid JSON"));
        app.exception(Exception.class, (error, ctx) -> {
            LoggerFactory.getLogger(ServiceMain.class).error("request {} failed", ctx.attribute("requestId"), error);
            error(ctx, 500, "internal server error");
        });
        return app;
    }

    /** Counts and times a finished route request by outcome, and logs it. */
    private static void finish(PrometheusMeterRegistry metrics, RouteLog routeLog, Context ctx, RouteApi.RouteRequest request,
            String outcome, RoutingEngine.Routed routed, long received, long started) {
        long total = System.nanoTime() - received;
        Counter.builder("route_requests_total").tag("outcome", outcome).register(metrics).increment();
        Timer.builder("route_duration").tag("outcome", outcome).publishPercentileHistogram().register(metrics)
            .record(total, TimeUnit.NANOSECONDS);
        routeLog.log(ctx, request, outcome, ctx.statusCode(), routed, total, started < 0 ? -1 : started - received);
    }

    /** Search effort, for spotting the routes that cost most. */
    private static void record(PrometheusMeterRegistry metrics, RoutingEngine.Routed routed) {
        Map<String, Object> stats = routed.stats;
        Counter.builder("route_cache_lookups_total").tag("cache", "route")
            .tag("result", Boolean.TRUE.equals(stats.get("routeCacheHit")) ? "hit" : "miss").register(metrics).increment();
        if (stats.get("nodesChecked") instanceof Integer) {
            DistributionSummary.builder("route_search_nodes").publishPercentileHistogram().register(metrics)
                .record((Integer) stats.get("nodesChecked"));
        }
    }

    private static String path(InvalidFormatException error) {
        StringBuilder path = new StringBuilder();
        error.getPath().forEach(reference -> {
            if (reference.getFieldName() != null) {
                path.append(path.length() == 0 ? "" : ".").append(reference.getFieldName());
            } else {
                path.append('[').append(reference.getIndex()).append(']');
            }
        });
        return path.toString();
    }

    private static Throwable cause(Throwable error) {
        Throwable result = error;
        while ((result instanceof CompletionException || result instanceof ExecutionException)
                && result.getCause() != null) {
            result = result.getCause();
        }
        return result;
    }

    private static void error(Context ctx, int status, String message) {
        ctx.status(status).json(new ErrorResponse(message, ctx.attribute("requestId")));
    }

    /** The body of every error response. */
    public static final class ErrorResponse {
        public final String error;
        public final String requestId;

        ErrorResponse(String error, String requestId) {
            this.error = error;
            this.requestId = requestId;
        }
    }
}

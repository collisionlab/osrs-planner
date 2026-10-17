package shortestpath.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.javalin.http.Context;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.spi.LoggingEventBuilder;
import shortestpath.routeapi.AccountJson;
import shortestpath.routeapi.RouteApi;

/**
 * One structured log line per {@code POST /v1/route} (logger {@code route}, message {@code route}):
 * the endpoints, which account and settings asked, the outcome, and how the search went. Custom
 * accounts are logged as a short hash, never their contents.
 */
final class RouteLog {
    private static final Logger LOG = LoggerFactory.getLogger("route");

    private final ObjectMapper mapper;
    /** Each preset's canonical account JSON (see {@link #canonical}) to its preset id. */
    private final Map<String, String> presets = new HashMap<>();

    RouteLog(ObjectMapper mapper, List<RouteApi.Preset> presets) {
        this.mapper = mapper;
        presets.forEach(preset -> this.presets.put(json(preset.account), preset.id));
    }

    /**
     * @param routed the plan and its search stats, or {@code null} when no route was planned
     * @param queueNanos time the request waited for a worker, or a negative number when it never started
     */
    void log(Context ctx, RouteApi.RouteRequest request, String outcome, int status,
            RoutingEngine.Routed routed, long totalNanos, long queueNanos) {
        try {
            write(ctx, request, outcome, status, routed, totalNanos, queueNanos);
        } catch (RuntimeException error) {
            // A log line must never fail the response it describes.
            LOG.warn("could not log route {}", (Object) ctx.attribute("requestId"), error);
        }
    }

    private void write(Context ctx, RouteApi.RouteRequest request, String outcome, int status,
            RoutingEngine.Routed routed, long totalNanos, long queueNanos) {
        String accountJson = json(request.account);
        String preset = presets.get(accountJson);
        LoggingEventBuilder event = LOG.atInfo()
            .addKeyValue("event", "route")
            .addKeyValue("requestId", (Object) ctx.attribute("requestId"))
            .addKeyValue("outcome", outcome)
            .addKeyValue("status", status)
            .addKeyValue("durationMs", millis(totalNanos))
            .addKeyValue("from", location(request.start))
            .addKeyValue("to", location(request.destination))
            .addKeyValue("account", preset != null ? preset : "custom")
            .addKeyValue("settings", request.settings);
        if (preset == null) {
            // Tells repeat requests from one custom account apart without logging its contents.
            event = event.addKeyValue("accountHash", hash(accountJson));
        }
        if (queueNanos >= 0) {
            event = event.addKeyValue("queueMs", millis(queueNanos));
        }
        String trigger = ctx.header("X-Route-Trigger");
        if (trigger != null && trigger.matches("[a-z-]{1,16}")) {
            event = event.addKeyValue("trigger", trigger);
        }
        String country = ctx.header("CF-IPCountry");
        if (country != null && country.matches("[A-Z0-9]{2}")) {
            event = event.addKeyValue("country", country);
        }
        if (routed != null) {
            event = event.addKeyValue("reachable", routed.plan.reachable)
                .addKeyValue("costTicks", routed.plan.costTicks)
                .addKeyValue("legs", legs(routed.plan))
                .addKeyValue("search", routed.stats);
        }
        event.log("route");
    }

    /** The preset id the account is, or {@code null} for a custom account. */
    String preset(AccountJson account) {
        return presets.get(json(account));
    }

    private static Map<String, Object> location(RouteApi.Location location) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("x", location.coordinate.x);
        result.put("y", location.coordinate.y);
        result.put("plane", location.coordinate.plane);
        if (location.placeId != null) {
            result.put("placeId", location.placeId);
        }
        return result;
    }

    /** How many legs of each kind, and the transports and teleports the route takes, in order. */
    private Map<String, Object> legs(RouteApi.RoutePlan plan) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        List<String> travel = new ArrayList<>();
        for (Object segment : plan.segments) {
            Map<?, ?> fields = mapper.convertValue(segment, Map.class);
            counts.merge(String.valueOf(fields.get("kind")), 1, Integer::sum);
            if (fields.get("name") != null) {
                travel.add(String.valueOf(fields.get("name")));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>(counts);
        result.put("travel", travel);
        return result;
    }

    /**
     * The value's JSON with object keys and string arrays sorted. The frontend sends a preset back
     * unchanged in content but not in order: browsers reorder integer-like keys (item ids), and
     * Jackson reads enum sets into hash sets.
     */
    private String json(Object value) {
        return canonical(mapper.valueToTree(value)).toString();
    }

    private JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            ObjectNode sorted = mapper.createObjectNode();
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            names.sort(null);
            names.forEach(name -> sorted.set(name, canonical(node.get(name))));
            return sorted;
        }
        if (node.isArray()) {
            List<JsonNode> items = new ArrayList<>();
            node.forEach(item -> items.add(canonical(item)));
            if (items.stream().allMatch(JsonNode::isTextual)) {
                items.sort((a, b) -> a.asText().compareTo(b.asText()));
            }
            ArrayNode sorted = mapper.createArrayNode();
            items.forEach(sorted::add);
            return sorted;
        }
        return node;
    }

    private static String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < 6; i++) {
                result.append(String.format("%02x", digest[i]));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static double millis(long nanos) {
        return Math.round(nanos / 10_000.0) / 100.0;
    }
}

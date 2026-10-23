package shortestpath.workbench;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.composite.CompositeMeterRegistry;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

/**
 * What the workbench's backend reports to {@code /metrics}: git (the only thing that can be slow),
 * GitHub's pull request listing and its rate limit, and the open list's freshness. Records nothing
 * until {@link #bindTo} is given the service's registry.
 */
final class WorkbenchMetrics {
    private volatile MeterRegistry registry = new CompositeMeterRegistry();
    /** -1 until GitHub has answered. */
    private final AtomicLong rateLimitRemaining = new AtomicLong(-1);
    private final AtomicLong lastListed = new AtomicLong(0);
    private final AtomicLong openPulls = new AtomicLong(0);

    void bindTo(MeterRegistry registry) {
        this.registry = registry;
        Gauge.builder("workbench_github_ratelimit_remaining", rateLimitRemaining, AtomicLong::get)
            .description("Requests left in GitHub's rate limit window, as its last answer said").register(registry);
        Gauge.builder("workbench_open_pulls_listed_timestamp_seconds", lastListed, AtomicLong::get)
            .description("When the open pull requests were last listed (0 before the first listing)").register(registry);
        Gauge.builder("workbench_open_pulls", openPulls, AtomicLong::get)
            .description("Open pull requests that change transports, as last listed").register(registry);
    }

    MeterRegistry registry() {
        return registry;
    }

    /** A git command, by its subcommand ({@code clone}, {@code fetch}, {@code ls-remote}, ...). */
    void git(String command, boolean ok, long nanos) {
        Timer.builder("workbench_git_duration").tag("command", command).tag("outcome", ok ? "ok" : "error")
            .publishPercentileHistogram().maximumExpectedValue(Duration.ofSeconds(120)).register(registry).record(Duration.ofNanos(nanos));
    }

    /** A listing of open pull requests from GitHub: {@code ok}, {@code not_modified} or {@code error}. */
    void githubListing(String outcome, Long remaining) {
        Counter.builder("workbench_github_listings_total").tag("outcome", outcome).register(registry).increment();
        if (remaining != null) {
            rateLimitRemaining.set(remaining);
        }
    }

    /** A refresh of one repository's open list. */
    void refreshed(boolean ok, int listed) {
        Counter.builder("workbench_refreshes_total").tag("outcome", ok ? "ok" : "error").register(registry).increment();
        if (ok) {
            lastListed.set(System.currentTimeMillis() / 1000);
            openPulls.set(listed);
        }
    }

    /** A review computed from git (a cache miss). */
    void reviewBuilt(long nanos) {
        Timer.builder("workbench_review_build_duration").publishPercentileHistogram()
            .maximumExpectedValue(Duration.ofSeconds(120)).register(registry).record(Duration.ofNanos(nanos));
    }

    /** A request to the workbench API, by route ({@code files}, {@code pull}, {@code pulls}, ...) and status. */
    void request(String route, int status, long nanos) {
        Timer.builder("workbench_requests").tag("route", route).tag("status", String.valueOf(status))
            .publishPercentileHistogram().maximumExpectedValue(Duration.ofSeconds(120)).register(registry).record(Duration.ofNanos(nanos));
    }
}

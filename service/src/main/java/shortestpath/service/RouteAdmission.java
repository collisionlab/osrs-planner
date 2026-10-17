package shortestpath.service;

import java.util.concurrent.TimeUnit;

/**
 * Which route requests to plan when the service is busy. A route takes tens of milliseconds, so a
 * deep queue absorbs a burst; but a request that waited too long has likely been given up on, and
 * drag previews (header {@code X-Route-Trigger: drag}) are refused first: a skipped preview is
 * invisible, and a late one is already stale.
 */
final class RouteAdmission {
    /** Requests that may wait for a worker; beyond this the executor refuses them outright. */
    static final int QUEUE = 256;
    /** How long a request may wait for a worker before it is refused instead of planned. */
    static final long MAX_WAIT_NANOS = TimeUnit.SECONDS.toNanos(5);
    /** How long a drag preview may wait: the pointer has moved on by then. */
    static final long MAX_DRAG_WAIT_NANOS = TimeUnit.MILLISECONDS.toNanos(300);

    /** Thrown inside a worker for a request that waited too long. */
    static final class Stale extends RuntimeException {
        Stale() {
            super("waited too long for a worker", null, false, false);
        }
    }

    private RouteAdmission() { }

    /** Whether to queue a request now, given how many already wait for the {@code workers}. */
    static boolean admit(boolean drag, int queued, int workers) {
        // A preview only queues behind less than one round of work.
        return !drag || queued < workers;
    }

    /** Whether a request that waited {@code waitedNanos} should still be planned. */
    static boolean fresh(boolean drag, long waitedNanos) {
        return waitedNanos <= (drag ? MAX_DRAG_WAIT_NANOS : MAX_WAIT_NANOS);
    }
}

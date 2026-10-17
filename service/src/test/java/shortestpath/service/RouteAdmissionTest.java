package shortestpath.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class RouteAdmissionTest {
    @Test
    void routesQueueDeeplyButDragPreviewsOnlyBehindOneRound() {
        assertTrue(RouteAdmission.admit(false, 200, 4));
        assertTrue(RouteAdmission.admit(true, 3, 4));
        assertFalse(RouteAdmission.admit(true, 4, 4));
    }

    @Test
    void requestsThatWaitedTooLongAreRefused() {
        assertTrue(RouteAdmission.fresh(false, TimeUnit.SECONDS.toNanos(4)));
        assertFalse(RouteAdmission.fresh(false, TimeUnit.SECONDS.toNanos(6)));
        assertTrue(RouteAdmission.fresh(true, TimeUnit.MILLISECONDS.toNanos(200)));
        assertFalse(RouteAdmission.fresh(true, TimeUnit.MILLISECONDS.toNanos(400)));
    }
}

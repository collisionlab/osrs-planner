package shortestpath.routeapi;

import static org.junit.Assert.assertEquals;

import java.util.List;
import org.junit.Test;
import shortestpath.WorldPointUtil;
import shortestpath.pathfinder.BankVisitState;
import shortestpath.pathfinder.PathStep;
import shortestpath.pathfinder.PathTerminationReason;
import shortestpath.pathfinder.PathfinderBackend;
import shortestpath.pathfinder.PathfinderResult;
import shortestpath.profiles.Profiles;
import shortestpath.profiles.ProfileContext;
import shortestpath.transport.Transport;
import shortestpath.transport.TransportType;

public class RoutePlansTest {
    @Test
    public void preservesBankTransitionsAndTheChosenTransport() {
        int start = WorldPointUtil.packWorldPoint(3222, 3218, 0);
        int target = WorldPointUtil.packWorldPoint(3210, 3424, 0);
        Transport chosen = new Transport.TransportBuilder().origin(start).destination(target)
            .type(TransportType.TELEPORTATION_ITEM).displayInfo("Chosen teleport").duration(4).build();
        List<PathStep> steps = List.of(new PathStep(start, BankVisitState.CARRIED),
            new PathStep(start, BankVisitState.BANKED), new PathStep(target, BankVisitState.BANKED, chosen));
        PathfinderResult result = new PathfinderResult(start, target, true, steps, target,
            0, 0, 0, PathTerminationReason.TARGET_REACHED);
        RouteApi.RoutePlan plan = RoutePlans.plan(null, null, result,
            Profiles.EARLY.setup(new ProfileContext(start, true)).compile().getConfig(),
            PathfinderBackend.ASTAR, String::valueOf);

        assertEquals(1, plan.segments.stream().filter(RouteApi.BankSegment.class::isInstance).count());
        RouteApi.TravelSegment travel = (RouteApi.TravelSegment) plan.segments.stream()
            .filter(RouteApi.TravelSegment.class::isInstance).findFirst().orElseThrow();
        assertEquals("Chosen teleport", travel.name);
        assertEquals(4, travel.costTicks);
    }
}

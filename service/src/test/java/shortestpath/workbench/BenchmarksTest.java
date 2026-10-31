package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import shortestpath.pathfinder.AStarRoutingStaticProvider;
import shortestpath.pathfinder.CollisionMap;
import shortestpath.pathfinder.PluginResources;

/** The workbench's benchmark cases: every tooling suite listed with its points, and a case run on demand. */
class BenchmarksTest {
    static Benchmarks benchmarks;

    @BeforeAll
    static void load() {
        benchmarks = new Benchmarks(new AStarRoutingStaticProvider(() -> new CollisionMap(PluginResources.map())).get(),
            Provenance.bundled(), id -> "Item " + id);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> scenarios() {
        return (List<Map<String, Object>>) benchmarks.index().get("scenarios");
    }

    @Test
    @SuppressWarnings("unchecked")
    void everySuiteIsListedWithItsScenariosPoints() {
        List<Map<String, Object>> suites = (List<Map<String, Object>>) benchmarks.index().get("suites");
        List<String> names = suites.stream().map(suite -> (String) suite.get("name")).collect(Collectors.toList());
        assertTrue(names.containsAll(List.of("canonical", "routing-issues", "clue-locations-full", "unit-tests")), names.toString());
        int total = suites.stream().mapToInt(suite -> (Integer) suite.get("scenarios")).sum();
        assertEquals(total, scenarios().size());
        Map<String, Object> canonical = scenarios().stream().filter(s -> s.get("name").equals("gps-natural-0001/early"))
            .findFirst().orElseThrow();
        assertEquals("canonical", canonical.get("suite"));
        assertEquals("gps-natural", canonical.get("category"));
        assertEquals(3, ((int[]) canonical.get("start")).length);
        assertEquals(3, ((int[]) canonical.get("target")).length);
    }

    @Test
    void aCaseRunsThroughToolingsRunnerAndIsKept() throws Exception {
        Map<String, Object> run = benchmarks.run("routing-issues", "Piscatoris colony (#148) enters through fence hole").get();
        assertEquals(true, run.get("reached"));
        assertEquals("astar", run.get("backend"));
        @SuppressWarnings("unchecked")
        Map<String, Object> check = (Map<String, Object>) run.get("check");
        assertEquals(true, check.get("passed"), String.valueOf(check.get("message")));
        @SuppressWarnings("unchecked")
        List<int[]> path = (List<int[]>) run.get("path");
        assertEquals(run.get("pathLength"), path.size());
        assertEquals(List.of(2344, 3670, 0), List.of(path.get(path.size() - 1)[0], path.get(path.size() - 1)[1],
            path.get(path.size() - 1)[2]));
        assertNotNull(run.get("phasesMs"));
        assertSame(run, benchmarks.run("routing-issues", "Piscatoris colony (#148) enters through fence hole").get());
    }

    @Test
    void aCaseWithTransportsListsThem() throws Exception {
        Map<String, Object> run = benchmarks.run("canonical", "gps-natural-0001/maxed").get();
        assertEquals(true, run.get("reached"));
        assertFalse(((List<?>) run.get("path")).isEmpty());
    }

    @Test
    void anUnknownCaseIsNotFound() {
        assertThrows(Reviews.NotFound.class, () -> benchmarks.run("canonical", "no such case"));
        assertThrows(Reviews.NotFound.class, () -> benchmarks.run("no-suite", "x"));
    }
}

package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import io.javalin.Javalin;
import io.javalin.testtools.JavalinTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TopologyRouteTest {
    private static Javalin app(byte[] report) {
        Javalin app = Javalin.create();
        Workbench.topologyRoutes(app, () -> report);
        app.exception(Reviews.NotFound.class, (error, ctx) -> ctx.status(404).json(java.util.Map.of("error", error.getMessage())));
        return app;
    }

    @Test
    void servesTheReportAsMade() {
        byte[] report = "{\"schemaVersion\":1}".getBytes(StandardCharsets.UTF_8);
        JavalinTest.test(app(report), (server, client) -> {
            var response = client.get("/workbench/v1/topology");
            assertEquals(200, response.code());
            assertEquals("public, max-age=300", response.header("Cache-Control"));
            assertArrayEquals(report, response.body().bytes());
        });
    }

    @Test
    void saysWhenThereIsNoReport() {
        JavalinTest.test(app(null), (server, client) -> {
            var response = client.get("/workbench/v1/topology");
            assertEquals(404, response.code());
            assertEquals("{\"error\":\"this build has no topology report from shortest-path-tooling\"}", response.body().string());
        });
    }

    @Test
    void readsTheConfiguredFileElseTheClasspath(@TempDir Path directory) throws Exception {
        Path file = directory.resolve("topology.json");
        Files.writeString(file, "{}");
        assertArrayEquals("{}".getBytes(StandardCharsets.UTF_8), Workbench.topologyReport(file.toString()));
        assertNull(Workbench.topologyReport(null));
        assertEquals("topology", Workbench.route("/api/workbench/v1/topology"));
    }
}

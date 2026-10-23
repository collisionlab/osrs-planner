package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.testtools.JavalinTest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Reviews read from a local repository laid out as GitHub keeps one, pull request refs included. */
class ReviewsTest {
    static final String FILE = "src/main/resources/transports/agility_shortcuts.tsv";

    @TempDir
    static Path temp;
    static String remote, base, head, master;

    @BeforeAll
    static void repository() throws IOException {
        Path work = temp.resolve("work"), bare = temp.resolve("remote/Owner/repo.git");
        git(temp, "init", "-q", "--bare", bare.toString());
        git(bare, "config", "uploadpack.allowFilter", "true");
        git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
        git(temp, "init", "-q", "-b", "master", work.toString());
        write(work, FILE, TransportDiffTest.tsv("## Gaps", "100 100 0\t106 100 0\tPass Gap 1\t\t"));
        write(work, "README.md", "readme\n");
        base = commit(work, "Base");
        git(work, "checkout", "-q", "-b", "feature");
        write(work, FILE, TransportDiffTest.tsv("## Gaps", "100 100 0\t106 100 0\tPass Gap 1\t\t", "106 100 0\t100 100 0\tPass Gap 2\t\t"));
        write(work, "README.md", "changed\n");
        head = commit(work, "Add the way back");
        // master moves on after the branch is cut: the review still compares against the merge base.
        git(work, "checkout", "-q", "master");
        write(work, "README.md", "master\n");
        master = commit(work, "Unrelated");
        git(work, "push", "-q", bare.toString(), "master", "feature:refs/pull/7/head");
        remote = temp.resolve("remote").toUri().toString();
    }

    static Reviews reviews() {
        return new Reviews(List.of("Owner/repo"), temp.resolve("cache-" + System.nanoTime()), remote);
    }

    @Test
    void reviewsAPullRequestAgainstItsMergeBase() {
        Reviews reviews = reviews();
        Reviews.Heads heads = reviews.heads("owner/REPO", 7);
        assertEquals(master, heads.base);
        assertEquals(head, heads.head);
        Reviews.Review review = reviews.pull("Owner/repo", 7, heads.base, heads.head);
        assertEquals("Owner/repo", review.repository);
        assertEquals(base, review.mergeBase);
        assertEquals("Add the way back", review.headSubject);
        assertEquals(Map.of("added", 1, "removed", 0, "changed", 0), review.counts);
        assertEquals(1, review.units.size());
        assertEquals("agility_shortcuts-4", review.units.get(0).id);
        assertEquals("Pass Gap 2", review.units.get(0).changes.get(0).head.label);
    }

    @Test
    void clonesAheadOfTheFirstRequest() throws InterruptedException {
        Path cache = temp.resolve("cache-warm");
        new Reviews(List.of("Owner/repo"), cache, remote).warm();
        for (int i = 0; i < 100 && !Files.isDirectory(cache.resolve("Owner/repo.git/objects")); i++) {
            Thread.sleep(50);
        }
        assertTrue(Files.isDirectory(cache.resolve("Owner/repo.git/objects")));
    }

    @Test
    void comparesBranchesAndRefusesOtherRepositoriesAndMissingPulls() {
        Reviews reviews = reviews();
        Reviews.Review review = reviews.compare("Owner/repo", base, head);
        assertEquals(1, review.units.size());
        assertNull(review.pull);
        assertThrows(Reviews.NotServed.class, () -> reviews.heads("Other/repo", 7));
        assertThrows(Reviews.NotFound.class, () -> reviews.heads("Owner/repo", 8));
        assertThrows(IllegalArgumentException.class, () -> reviews.compare("Owner/repo", "--upload-pack=x", head));
        assertThrows(IllegalArgumentException.class, () -> reviews.pull("Owner/repo", 7, "master", head));
    }

    @Test
    void servesImmutableRangesAndTheCurrentPullRequest() {
        Reviews reviews = reviews();
        Javalin app = Javalin.create();
        Workbench.routes(app, reviews);
        app.exception(Reviews.NotServed.class, (error, ctx) -> ctx.status(404));
        app.exception(Reviews.NotFound.class, (error, ctx) -> ctx.status(404));
        ObjectMapper mapper = new ObjectMapper();
        JavalinTest.test(app, (server, client) -> {
            var pinned = client.get("/workbench/v1/github/Owner/repo/pull/7/files/" + master + ".." + head);
            assertEquals(200, pinned.code());
            assertEquals("public, max-age=31536000, immutable", pinned.header("Cache-Control"));
            JsonNode body = mapper.readTree(pinned.body().string());
            assertEquals(base, body.get("mergeBase").asText());
            assertEquals("Pass Gap 2", body.at("/units/0/changes/0/head/label").asText());
            assertEquals(106, body.at("/units/0/changes/0/head/origin/x").asInt());
            var current = client.get("/workbench/v1/github/Owner/repo/pull/7");
            assertEquals("public, max-age=60", current.header("Cache-Control"));
            assertEquals(head, mapper.readTree(current.body().string()).get("head").asText());
            assertEquals(head, mapper.readTree(client.get("/workbench/v1/github/Owner/repo/pull/7/heads").body().string()).get("head").asText());
            assertEquals(404, client.get("/workbench/v1/github/Owner/repo/compare/master...no-such-branch").code());
            assertEquals(404, client.get("/workbench/v1/github/Other/repo/pull/7").code());
        });
    }

    private static void write(Path work, String path, String text) throws IOException {
        Files.createDirectories(work.resolve(path).getParent());
        Files.writeString(work.resolve(path), text);
    }

    private static String commit(Path work, String message) {
        git(work, "add", "-A");
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", message);
        return git(work, "rev-parse", "HEAD").trim();
    }

    private static String git(Path dir, String... args) {
        List<String> command = new ArrayList<>(List.of("git"));
        command.addAll(List.of(args));
        try {
            Process process = new ProcessBuilder(command).directory(dir.toFile()).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (process.waitFor() != 0) {
                throw new IllegalStateException(command + ": " + output);
            }
            return output;
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }
}

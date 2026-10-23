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
    static String remote, base, head, master, docs;

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
        // A pull request that touches no transports, which the open list leaves out.
        git(work, "checkout", "-q", "-b", "docs", base);
        write(work, "README.md", "docs\n");
        docs = commit(work, "Docs");
        git(work, "push", "-q", bare.toString(), "master", "feature:refs/pull/7/head", "docs:refs/pull/8/head");
        remote = temp.resolve("remote").toUri().toString();
    }

    static Reviews reviews() {
        return new Reviews(List.of("Owner/repo"), temp.resolve("cache-" + System.nanoTime()), remote, null);
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
    void listsOpenPullRequestsThatChangeTransportsAndAsksGitHubWithTheLastETag() {
        List<String> asked = new ArrayList<>();
        Javalin github = Javalin.create().get("/repos/Owner/repo/pulls", ctx -> {
            asked.add(ctx.header("If-None-Match"));
            if ("\"v1\"".equals(ctx.header("If-None-Match"))) {
                ctx.status(304);
                return;
            }
            ctx.header("ETag", "\"v1\"").contentType("application/json").result("["
                + pull(7, head, "master", false) + "," + pull(8, docs, "master", false) + "," + pull(9, head, "release", true) + "]");
        }).start(0);
        try {
            Path cache = temp.resolve("cache-list");
            Reviews reviews = new Reviews(List.of("Owner/repo"), cache, remote, new GitHubPulls("http://localhost:" + github.port() + "/", null));
            assertNull(reviews.openPulls("Owner/repo").refreshedAt);
            reviews.refresh();
            assertTrue(Files.isDirectory(cache.resolve("Owner/repo.git/objects")));
            Reviews.PullList list = reviews.openPulls("owner/repo");
            assertEquals(1, list.pulls.size());
            Reviews.PullSummary pull = list.pulls.get(0);
            assertEquals(7, pull.number);
            assertEquals("Pull 7", pull.title);
            assertEquals("someone", pull.author);
            assertEquals(master, pull.base);
            assertEquals(head, pull.head);
            assertEquals(1, pull.units);
            assertEquals(1, pull.counts.get("added"));
            reviews.refresh();
            assertEquals(1, reviews.openPulls("Owner/repo").pulls.size());
            assertEquals(java.util.Arrays.asList(null, "\"v1\""), asked);
        } finally {
            github.stop();
        }
    }

    private static String pull(int number, String sha, String base, boolean draft) {
        return "{\"number\":" + number + ",\"title\":\"Pull " + number + "\",\"draft\":" + draft
            + ",\"user\":{\"login\":\"someone\"},\"base\":{\"ref\":\"" + base + "\"},\"head\":{\"sha\":\"" + sha
            + "\"},\"updated_at\":\"2026-10-23T00:00:00Z\"}";
    }

    @Test
    void comparesBranchesAndRefusesOtherRepositoriesAndMissingPulls() {
        Reviews reviews = reviews();
        Reviews.Review review = reviews.compare("Owner/repo", base, head);
        assertEquals(1, review.units.size());
        assertNull(review.pull);
        assertThrows(Reviews.NotServed.class, () -> reviews.heads("Other/repo", 7));
        assertThrows(Reviews.NotFound.class, () -> reviews.heads("Owner/repo", 99));
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
            assertEquals(200, client.get("/workbench/v1/github/Owner/repo/pulls").code());
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

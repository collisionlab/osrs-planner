package shortestpath.workbench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.LoggerFactory;

/**
 * A repository's open pull requests, from GitHub's API: the one thing git can't tell (GitHub keeps
 * {@code refs/pull/<n>/head} for closed pull requests too). Each listing is asked for with the last
 * one's ETag, and GitHub doesn't count an unchanged answer against the rate limit, so polling every
 * few minutes needs no token. A {@code token} only raises the limit.
 */
final class GitHubPulls {
    /** What a review list needs of an open pull request. */
    static final class OpenPull {
        final int number;
        final String title, author, baseRef, head, updatedAt;
        final boolean draft;

        OpenPull(int number, String title, String author, boolean draft, String baseRef, String head, String updatedAt) {
            this.number = number;
            this.title = title;
            this.author = author;
            this.draft = draft;
            this.baseRef = baseRef;
            this.head = head;
            this.updatedAt = updatedAt;
        }
    }

    private static final class Listing {
        final String etag;
        final List<OpenPull> pulls;

        Listing(String etag, List<OpenPull> pulls) {
            this.etag = etag;
            this.pulls = pulls;
        }
    }

    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, Listing> last = new ConcurrentHashMap<>();
    private final String api, token;

    /** {@code api} is {@code https://api.github.com/}, or a stand-in in tests; {@code token} may be null. */
    GitHubPulls(String api, String token) {
        this.api = api;
        this.token = token;
    }

    /** The open pull requests, oldest number last; the first 100, which is plenty for a plugin's repository. */
    List<OpenPull> open(String repository) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(api + "repos/" + repository + "/pulls?state=open&per_page=100"))
            .timeout(Duration.ofSeconds(30))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "collisionlab-workbench");
        if (token != null && !token.isBlank()) {
            request.header("Authorization", "Bearer " + token);
        }
        Listing previous = last.get(repository);
        if (previous != null) {
            request.header("If-None-Match", previous.etag);
        }
        HttpResponse<String> response;
        try {
            response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted", e);
        }
        if (response.statusCode() == 304 && previous != null) {
            return previous.pulls;
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException("GitHub answered " + response.statusCode() + " for " + repository + "'s pull requests");
        }
        if (response.headers().firstValue("Link").filter(link -> link.contains("rel=\"next\"")).isPresent()) {
            LoggerFactory.getLogger(GitHubPulls.class).warn("{} has more than 100 open pull requests; listing the first 100", repository);
        }
        List<OpenPull> pulls = new ArrayList<>();
        try {
            for (JsonNode pull : mapper.readTree(response.body())) {
                pulls.add(new OpenPull(pull.get("number").asInt(), pull.path("title").asText(), pull.at("/user/login").asText(),
                    pull.path("draft").asBoolean(), pull.at("/base/ref").asText(), pull.at("/head/sha").asText(),
                    pull.path("updated_at").asText()));
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        response.headers().firstValue("ETag").ifPresent(etag -> last.put(repository, new Listing(etag, pulls)));
        return pulls;
    }
}

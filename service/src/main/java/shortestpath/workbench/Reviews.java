package shortestpath.workbench;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.LoggerFactory;

/**
 * Transport reviews of a pull request or a compare range, read from git and cached by the two
 * commits they compare, so a review link shows the same rows to everyone, however often it is opened.
 */
public final class Reviews {
    static final String[] REVIEWED_DIRS = {"src/main/resources/transports", "src/main/resources/destinations"};

    /** What a review page shows. {@code base} and {@code head} are the range asked for. */
    public static final class Review {
        public final String apiVersion = "workbench-review-v1";
        public final String repository;
        public final Integer pull;
        public final String base, head, mergeBase;
        /** The head commit's subject line, which names most pushes well enough to tell them apart. */
        public final String headSubject;
        public final Map<String, Integer> counts;
        public final List<TransportDiff.Unit> units;

        Review(String repository, Integer pull, String base, String head, String mergeBase, String headSubject,
                List<TransportDiff.Unit> units) {
            this.repository = repository;
            this.pull = pull;
            this.base = base;
            this.head = head;
            this.mergeBase = mergeBase;
            this.headSubject = headSubject;
            this.counts = TransportDiff.counts(units);
            this.units = units;
        }
    }

    /** Where a pull request's branches are now. */
    public static final class Heads {
        public final String base, head;

        Heads(String base, String head) {
            this.base = base;
            this.head = head;
        }
    }

    private final Map<String, GitSource> sources = new LinkedHashMap<>();
    private final Cache<String, Review> reviews = Caffeine.newBuilder().maximumSize(256).build();
    private final Cache<String, Heads> heads = Caffeine.newBuilder().maximumSize(256).expireAfterWrite(Duration.ofMinutes(1)).build();

    /** {@code repositories} are {@code owner/name}, the only ones served; {@code remote} as in {@link GitSource}. */
    public Reviews(List<String> repositories, Path cache, String remote) {
        for (String repository : repositories) {
            sources.put(repository.toLowerCase(), new GitSource(repository, cache, remote));
        }
    }

    /**
     * Clones each repository in the background, so the first review after a deploy (a new container,
     * an empty cache) doesn't wait for it. A failure only logs: the first request clones instead.
     */
    public void warm() {
        Thread thread = new Thread(() -> {
            for (GitSource source : sources.values()) {
                try {
                    source.warm();
                } catch (RuntimeException e) {
                    LoggerFactory.getLogger(Reviews.class).warn("could not clone {} ahead of requests", source.repository(), e);
                }
            }
        }, "workbench-warm");
        thread.setDaemon(true);
        thread.start();
    }

    /** The served repository's canonical name, or {@code null}. */
    String repository(String owner, String name) {
        GitSource source = sources.get((owner + "/" + name).toLowerCase());
        return source == null ? null : source.repository();
    }

    private GitSource source(String repository) {
        GitSource source = sources.get(repository.toLowerCase());
        if (source == null) {
            throw new NotServed(repository);
        }
        return source;
    }

    /** The pull request's head and its base branch's tip, as GitHub has them now (cached a minute). */
    public Heads heads(String repository, int pull) {
        GitSource source = source(repository);
        return heads.get(source.repository() + "#" + pull, key -> {
            String head = source.remoteHead(pullRef(pull));
            if (head == null) {
                throw new NotFound("pull request #" + pull + " is not in " + source.repository());
            }
            return new Heads(source.remoteHead("refs/heads/" + source.defaultBranch()), head);
        });
    }

    /** A pull request between two commits: {@code base} is a tip of its base branch, {@code head} a push. */
    public Review pull(String repository, int pull, String base, String head) {
        requireSha(base);
        requireSha(head);
        GitSource source = source(repository);
        return reviews.get(String.join(" ", source.repository(), "pull", String.valueOf(pull), base, head), key -> {
            source.fetch(head, pullRef(pull));
            source.fetch(base, "refs/heads/" + source.defaultBranch());
            return review(source, pull, base, head);
        });
    }

    /** A compare range of commits or branch names, as GitHub's {@code /compare/a...b}. */
    public Review compare(String repository, String base, String head) {
        GitSource source = source(repository);
        String baseSha = resolve(source, base), headSha = resolve(source, head);
        return reviews.get(String.join(" ", source.repository(), "compare", baseSha, headSha),
            key -> review(source, null, baseSha, headSha));
    }

    private static String resolve(GitSource source, String ref) {
        if (GitSource.SHA.matcher(ref).matches()) {
            source.fetch(ref, "refs/heads/" + source.defaultBranch());
            return ref;
        }
        if (!GitSource.BRANCH.matcher(ref).matches()) {
            throw new IllegalArgumentException("not a branch or commit: " + ref);
        }
        String sha = source.remoteHead("refs/heads/" + ref);
        if (sha == null) {
            throw new NotFound("branch " + ref + " is not in " + source.repository());
        }
        source.fetch(sha, "refs/heads/" + ref);
        return sha;
    }

    private static Review review(GitSource source, Integer pull, String base, String head) {
        String mergeBase = source.mergeBase(base, head);
        List<TransportDiff.FileVersions> files = new ArrayList<>();
        for (String[] change : source.changed(mergeBase, head, REVIEWED_DIRS)) {
            String status = change[0], path = change[1];
            if (!TransportDiff.isReviewedFile(path)) {
                continue;
            }
            files.add(new TransportDiff.FileVersions(path,
                status.startsWith("A") ? null : source.read(mergeBase, path),
                status.startsWith("D") ? null : source.read(head, path)));
        }
        return new Review(source.repository(), pull, base, head, mergeBase, source.subject(head), TransportDiff.units(files));
    }

    private static String pullRef(int pull) {
        return "refs/pull/" + pull + "/head";
    }

    private static void requireSha(String sha) {
        if (!GitSource.SHA.matcher(sha).matches()) {
            throw new IllegalArgumentException("not a full commit id: " + sha);
        }
    }

    /** A repository this service doesn't read. */
    public static final class NotServed extends RuntimeException {
        NotServed(String repository) {
            super(repository + " is not reviewed here");
        }
    }

    /** A pull request, branch or commit the repository doesn't have. */
    public static final class NotFound extends RuntimeException {
        NotFound(String message) {
            super(message);
        }
    }
}

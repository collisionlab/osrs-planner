package shortestpath.workbench;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
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

    /** An open pull request that changes transports or destinations, as the workbench lists it. */
    public static final class PullSummary {
        public final int number;
        public final String title, author, updatedAt;
        public final boolean draft;
        /** The range its review compares, as {@link #pull} takes it. */
        public final String base, head;
        public final Map<String, Integer> counts;
        public final int units;

        PullSummary(GitHubPulls.OpenPull pull, Review review) {
            this.number = pull.number;
            this.title = pull.title;
            this.author = pull.author;
            this.updatedAt = pull.updatedAt;
            this.draft = pull.draft;
            this.base = review.base;
            this.head = review.head;
            this.counts = review.counts;
            this.units = review.units.size();
        }
    }

    /** A repository's open pull requests that change transports, as of {@code refreshedAt} (ISO 8601; null before the first listing). */
    public static final class PullList {
        public final String repository;
        public final String refreshedAt;
        public final List<PullSummary> pulls;

        PullList(String repository, String refreshedAt, List<PullSummary> pulls) {
            this.repository = repository;
            this.refreshedAt = refreshedAt;
            this.pulls = pulls;
        }
    }

    private final Map<String, GitSource> sources = new LinkedHashMap<>();
    private final GitHubPulls github;
    private final Map<String, PullList> open = new ConcurrentHashMap<>();
    private final Cache<String, Review> reviews = Caffeine.newBuilder().maximumSize(256).build();
    private final Cache<String, Heads> heads = Caffeine.newBuilder().maximumSize(256).expireAfterWrite(Duration.ofMinutes(1)).build();

    /**
     * {@code repositories} are {@code owner/name}, the only ones served; {@code remote} as in {@link GitSource};
     * {@code github} lists open pull requests, or is null for no list.
     */
    Reviews(List<String> repositories, Path cache, String remote, GitHubPulls github) {
        this.github = github;
        for (String repository : repositories) {
            sources.put(repository.toLowerCase(), new GitSource(repository, cache, remote));
        }
    }

    /**
     * Clones each repository and lists its open pull requests in the background, then lists them again
     * every {@code every}, so the first review after a deploy (a new container, an empty cache) doesn't
     * wait for the clone and the list's reviews are ready before anyone opens them. Failures only log:
     * a request clones by itself, and the list stays as it last was.
     */
    public void start(Duration every) {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "workbench-refresh");
            thread.setDaemon(true);
            return thread;
        });
        scheduler.scheduleWithFixedDelay(this::refresh, 0, every.toMillis(), TimeUnit.MILLISECONDS);
    }

    /** Clones each repository if it isn't yet, and lists its open pull requests again. */
    void refresh() {
        for (GitSource source : sources.values()) {
            try {
                source.warm();
                if (github != null) {
                    open.put(source.repository().toLowerCase(), listOpen(source));
                }
            } catch (RuntimeException e) {
                LoggerFactory.getLogger(Reviews.class).warn("could not refresh {}", source.repository(), e);
            }
        }
    }

    private PullList listOpen(GitSource source) {
        String branch = source.defaultBranch();
        String base = source.remoteHead("refs/heads/" + branch);
        List<PullSummary> pulls = new ArrayList<>();
        for (GitHubPulls.OpenPull pull : github.open(source.repository())) {
            if (!pull.baseRef.equals(branch) || !GitSource.SHA.matcher(pull.head).matches()) {
                continue;
            }
            try {
                Review review = pull(source.repository(), pull.number, base, pull.head);
                if (!review.units.isEmpty()) {
                    pulls.add(new PullSummary(pull, review));
                }
            } catch (RuntimeException e) {
                LoggerFactory.getLogger(Reviews.class).warn("could not review {}#{}", source.repository(), pull.number, e);
            }
        }
        return new PullList(source.repository(), Instant.now().toString(), pulls);
    }

    /** The open pull requests that change transports, as last listed. */
    public PullList openPulls(String repository) {
        GitSource source = source(repository);
        return open.getOrDefault(source.repository().toLowerCase(), new PullList(source.repository(), null, List.of()));
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

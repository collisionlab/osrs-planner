package shortestpath.workbench;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * A GitHub repository read with git, not GitHub's API: a bare partial clone (commits and trees,
 * blobs fetched when read) kept on local disk as a cache, so there is no token and no rate limit.
 * Pull requests from forks are read through the {@code refs/pull/<n>/head} refs GitHub keeps on the
 * upstream repository. The clone can be deleted at any time; it is made again on the next request.
 */
final class GitSource {
    static final Pattern SHA = Pattern.compile("^[0-9a-f]{40}$");
    /** Branch names as GitHub compare URLs carry them; never an option or a revision expression. */
    static final Pattern BRANCH = Pattern.compile("^(?!-)(?!.*\\.\\.)[A-Za-z0-9_./-]{1,200}$");
    private static final long TIMEOUT_SECONDS = 120;
    /** Drains git's output streams; blocking reads stay off the common pool. */
    private static final ExecutorService PIPES = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "git-pipe");
        thread.setDaemon(true);
        return thread;
    });

    private final String repository, remote;
    private final Path dir;

    /** {@code remote} is where repositories live: {@code https://github.com/}, or a directory in tests. */
    GitSource(String repository, Path cache, String remote) {
        this.repository = repository;
        this.remote = remote;
        this.dir = cache.resolve(repository + ".git");
    }

    String repository() {
        return repository;
    }

    /** What a remote ref points at now, or {@code null}; asks GitHub, fetches nothing. */
    synchronized String remoteHead(String ref) {
        ensureClone();
        for (String line : git("ls-remote", "origin", ref).split("\n")) {
            String[] parts = line.split("\t");
            if (parts.length == 2 && parts[1].equals(ref)) {
                return parts[0];
            }
        }
        return null;
    }

    /** The repository's default branch, as GitHub's HEAD names it ({@code master}). */
    synchronized String defaultBranch() {
        ensureClone();
        for (String line : git("ls-remote", "--symref", "origin", "HEAD").split("\n")) {
            if (line.startsWith("ref: refs/heads/")) {
                return line.substring("ref: refs/heads/".length(), line.indexOf('\t'));
            }
        }
        throw new IllegalStateException(repository + " has no default branch");
    }

    /** Makes sure the commit is local, fetching the given remote ref (which should contain it) if not. */
    synchronized void fetch(String sha, String ref) {
        ensureClone();
        if (has(sha)) {
            return;
        }
        git("fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin", "+" + ref + ":" + ref);
        if (!has(sha)) {
            // GitHub serves any commit reachable from its refs by id, such as an older push of a PR.
            git("fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin", sha);
        }
        if (!has(sha)) {
            throw new Reviews.NotFound("commit " + sha + " is not in " + repository);
        }
    }

    synchronized String mergeBase(String a, String b) {
        return git("merge-base", a, b).trim();
    }

    /** Paths that differ between two commits under the given directories, with their status letter. */
    synchronized List<String[]> changed(String base, String head, String... paths) {
        List<String> args = new ArrayList<>(List.of("diff", "--name-status", "--no-renames", base, head, "--"));
        args.addAll(List.of(paths));
        List<String[]> changes = new ArrayList<>();
        for (String line : git(args.toArray(String[]::new)).split("\n")) {
            if (!line.isEmpty()) {
                changes.add(line.split("\t", 2));
            }
        }
        return changes;
    }

    /** A file's contents at a commit, or {@code null} if it doesn't exist there. */
    synchronized String read(String sha, String path) {
        if (git("ls-tree", "--name-only", sha, "--", path).isBlank()) {
            return null;
        }
        return git("show", sha + ":" + path);
    }

    /** The first line of a commit's message. */
    synchronized String subject(String sha) {
        return git("log", "-1", "--format=%s", sha).trim();
    }

    private boolean has(String sha) {
        return run(List.of("cat-file", "-e", sha + "^{commit}")).exit == 0;
    }

    private void ensureClone() {
        if (Files.isDirectory(dir.resolve("objects"))) {
            return;
        }
        try {
            Files.createDirectories(dir.getParent());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        Path partial = dir.resolveSibling(dir.getFileName() + ".partial");
        deleteRecursively(partial);
        Result result = exec(List.of("git", "clone", "--quiet", "--bare", "--filter=blob:none", "--no-tags",
            remote + repository + ".git", partial.toString()), dir.getParent());
        if (result.exit != 0) {
            throw new IllegalStateException("git clone " + repository + " failed: " + result.error);
        }
        try {
            Files.move(partial, dir);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private String git(String... args) {
        Result result = run(List.of(args));
        if (result.exit != 0) {
            throw new IllegalStateException("git " + args[0] + " failed: " + result.error.trim());
        }
        return result.output;
    }

    private Result run(List<String> args) {
        List<String> command = new ArrayList<>(List.of("git", "--git-dir", dir.toString()));
        command.addAll(args);
        return exec(command, dir);
    }

    private static final class Result {
        final int exit;
        final String output, error;

        Result(int exit, String output, String error) {
            this.exit = exit;
            this.output = output;
            this.error = error;
        }
    }

    private static Result exec(List<String> command, Path workingDir) {
        ProcessBuilder builder = new ProcessBuilder(command).directory(workingDir.toFile());
        // Never prompt for credentials or read the host's git configuration.
        builder.environment().put("GIT_TERMINAL_PROMPT", "0");
        builder.environment().put("GIT_CONFIG_NOSYSTEM", "1");
        builder.environment().put("GIT_CONFIG_GLOBAL", "/dev/null");
        try {
            Process process = builder.start();
            CompletableFuture<byte[]> output = readAsync(process.getInputStream());
            CompletableFuture<byte[]> error = readAsync(process.getErrorStream());
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException(String.join(" ", command.subList(0, Math.min(4, command.size()))) + " timed out");
            }
            return new Result(process.exitValue(), new String(output.join(), StandardCharsets.UTF_8),
                new String(error.join(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted", e);
        }
    }

    private static CompletableFuture<byte[]> readAsync(InputStream stream) {
        return CompletableFuture.supplyAsync(() -> {
            try (stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                stream.transferTo(bytes);
                return bytes.toByteArray();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }, PIPES);
    }

    private static void deleteRecursively(Path path) {
        if (!Files.exists(path)) {
            return;
        }
        try (var walk = Files.walk(path)) {
            walk.sorted((a, b) -> b.compareTo(a)).forEach(p -> p.toFile().delete());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}

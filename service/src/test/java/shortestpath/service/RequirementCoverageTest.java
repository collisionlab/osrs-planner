package shortestpath.service;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import shortestpath.accounts.Account;
import shortestpath.accounts.AccountCompiler;
import shortestpath.accounts.ClientState;
import shortestpath.accounts.Unlock;
import shortestpath.accounts.canonical.CanonicalAccounts;
import shortestpath.transport.Transport;
import shortestpath.transport.ResourceLoader;
import shortestpath.requirement.model.VarRequirement;

/**
 * Every game variable a transport requires should be one a planner account can set: through a quest,
 * diary, unlock, spellbook or house. A transport needing anything else can never be taken in the
 * planner, which is a missing feature rather than a broken build: a plugin change that adds one must
 * not hold back a tooling bump. So the test reports instead of failing. It writes the variables
 * that are neither covered nor in {@link #KNOWN_GAPS}, and the known gaps the account model now
 * covers, to {@code build/reports/requirement-gaps.md}; CI shows the file on the PR and the daily
 * watcher lists it in the Follow-ups issue (docs/deployment.md).
 */
class RequirementCoverageTest {
    /**
     * Variables no account fact set on 2026-10-17, not yet reviewed: some are real gaps (diary item
     * teleports, Pendant of Ates sites), some are state the plugin reads another way (minigame
     * teleport timers). Remove an entry once the account model covers it; the test says when.
     * Added 2026-10-19 with the Chasm of Tears transports: the While Guthix Sleeps skull door (10820), a
     * quest varbit the account's quest states don't set.
     * Added 2026-10-27: Slepey tablet activation (12416) needs an account unlock, and
     * The Great Conch progress (18321) needs a quest-variable mapping; both remain unavailable.
     * Added 2026-10-30 with the master scroll book teleports: the book's stored scroll counts (9650,
     * 10967, 10995, 11029, 15749, 16238) and the Spider cave teleport's quest progress (varplayer 302).
     */
    private static final Set<String> KNOWN_GAPS = Set.of(
        "varbit 571",
        "varbit 9650",
        "varbit 10967",
        "varbit 10995",
        "varbit 11029",
        "varbit 15749",
        "varbit 16238",
        "varbit 1499",
        "varbit 1869",
        "varbit 1990",
        "varbit 3598",
        "varbit 4541",
        "varbit 4542",
        "varbit 4552",
        "varbit 4558",
        "varbit 4561",
        "varbit 4564",
        "varbit 4744",
        "varbit 4819",
        "varbit 4909",
        "varbit 5005",
        "varbit 5628",
        "varbit 6035",
        "varbit 6069",
        "varbit 7930",
        "varbit 7937",
        "varbit 7938",
        "varbit 10150",
        "varbit 10820",
        "varbit 11479",
        "varbit 12416",
        "varbit 16632",
        "varbit 16752",
        "varbit 16757",
        "varbit 18321",
        "varbit 19540",
        "varbit 19541",
        "varbit 19543",
        "varplayer 32",
        "varplayer 267",
        "varplayer 302",
        "varplayer 892",
        "varplayer 4560",
        "varplayer 4566");

    @Test
    void reportsRequiredVariablesNoAccountFactSets() throws ReflectiveOperationException, IOException {
        Account everything = CanonicalAccounts.account("maxed").toBuilder().unlock(Unlock.values()).build();
        ClientState state = AccountCompiler.compile(everything);
        Field id = VarRequirement.class.getDeclaredField("id");
        id.setAccessible(true);
        Map<String, Set<String>> missing = new TreeMap<>();
        for (Set<Transport> transports : ResourceLoader.transports().values()) {
            for (Transport transport : transports) {
                for (VarRequirement requirement : transport.getVarRequirements()) {
                    int variable = id.getInt(requirement);
                    boolean set = requirement.isVarbit() ? state.varbits().containsKey(variable)
                        : state.varplayers().containsKey(variable);
                    String name = (requirement.isVarbit() ? "varbit " : "varplayer ") + variable;
                    if (!set) {
                        missing.computeIfAbsent(name,
                            key -> new TreeSet<>()).add(String.valueOf(transport.getObjectInfo() != null
                                ? transport.getObjectInfo() : transport.getDisplayInfo()));
                    }
                }
            }
        }
        Set<String> covered = new TreeSet<>(KNOWN_GAPS);
        covered.removeAll(missing.keySet());
        missing.keySet().removeAll(KNOWN_GAPS);
        StringBuilder report = new StringBuilder();
        missing.forEach((name, transports) -> report.append("- `").append(name)
            .append("` has no account fact, so the planner never takes: ").append(String.join("; ", transports)).append('\n'));
        covered.forEach(name -> report.append("- `").append(name)
            .append("` is covered by the account model now: remove it from `RequirementCoverageTest.KNOWN_GAPS`\n"));
        Path file = Path.of("build/reports/requirement-gaps.md");
        Files.createDirectories(file.getParent());
        Files.writeString(file, report.toString());
        if (report.length() > 0) {
            System.out.println("Requirement coverage follow-ups:\n" + report);
        }
    }
}

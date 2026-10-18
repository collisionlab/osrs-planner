package shortestpath.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.lang.reflect.Field;
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
 * Every game variable a transport requires is one a planner account can set: through a quest,
 * diary, unlock, spellbook or house. A transport needing anything else can never be taken in the
 * planner, so a plugin change that adds one fails here until the account model covers it (an
 * {@link Unlock}) or it is listed in {@link #KNOWN_GAPS}.
 */
class RequirementCoverageTest {
    /**
     * Variables no account fact set on 2026-10-17, not yet reviewed: some are real gaps (diary item
     * teleports, Pendant of Ates sites), some are state the plugin reads another way (minigame
     * teleport timers). Remove an entry once the account model covers it; the test says when.
     */
    private static final Set<String> KNOWN_GAPS = Set.of(
        "varbit 571",
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
        "varbit 11479",
        "varbit 16632",
        "varbit 16752",
        "varbit 16757",
        "varbit 19540",
        "varbit 19541",
        "varbit 19543",
        "varplayer 32",
        "varplayer 267",
        "varplayer 892",
        "varplayer 4560",
        "varplayer 4566");

    @Test
    void everyRequiredVariableIsAnAccountFact() throws ReflectiveOperationException {
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
        assertEquals(Set.of(), covered, "now covered by the account model; remove from KNOWN_GAPS");
        missing.keySet().removeAll(KNOWN_GAPS);
        assertEquals(Map.of(), missing, "transports need variables no account fact sets");
    }
}

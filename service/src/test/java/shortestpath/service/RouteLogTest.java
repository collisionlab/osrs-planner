package shortestpath.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import shortestpath.accounts.canonical.CanonicalAccounts;
import shortestpath.routeapi.AccountJson;
import shortestpath.routeapi.RouteApi;

class RouteLogTest {
    private static final RouteApi.Preset EARLY = new RouteApi.Preset("early", "Early game",
        AccountJson.of("Early game", CanonicalAccounts.account("early")));
    private static final RouteLog LOG = new RouteLog(Requests.MAPPER, List.of(EARLY));

    @Test
    void namesAPresetTheBrowserSendsBack() throws Exception {
        // The browser parses the preset and sends it back; it reorders integer-like keys (item ids).
        ObjectNode sent = Requests.MAPPER.valueToTree(EARLY.account);
        AccountJson echoed = Requests.MAPPER.treeToValue(sent, AccountJson.class);
        assertEquals("early", LOG.preset(echoed));

        ((ObjectNode) sent.get("levels")).put("AGILITY", 99);
        assertNull(LOG.preset(Requests.MAPPER.treeToValue(sent, AccountJson.class)));
    }
}

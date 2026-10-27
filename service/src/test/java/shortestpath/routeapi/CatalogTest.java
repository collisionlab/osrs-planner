package shortestpath.routeapi;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.util.HashSet;
import java.util.Set;
import org.junit.Test;
import shortestpath.poh.PohNexusPortal;

public class CatalogTest {
    @Test
    public void portalIdsRemainValidAccountValues() {
        Catalog catalog = new Catalog();
        Set<PohNexusPortal> portals = new HashSet<>();
        for (Catalog.Option option : catalog.portals) {
            PohNexusPortal portal = PohNexusPortal.fromDisplayInfo(option.id);
            assertNotNull(option.id, portal);
            assertEquals(portal.toString(), option.name);
            portals.add(portal);
        }
        assertEquals(PohNexusPortal.values().length, catalog.portals.size());
        assertEquals(catalog.portals.size(), portals.size());
        assertEquals("Varrock / Grand Exchange", catalog.portals.stream()
            .filter(option -> option.id.equals("Varrock Portal")).findFirst().orElseThrow().name);
        assertEquals("Respawn", catalog.portals.stream()
            .filter(option -> option.id.equals("Respawn Portal (Lumbridge)")).findFirst().orElseThrow().name);
    }

    @Test
    public void namesEveryUnlockWithoutItsGroup() {
        // Building the catalog throws if an unlock has no display name.
        Catalog catalog = new Catalog();
        Catalog.Option falador = catalog.unlocks.stream().filter(unlock -> unlock.id.equals("RESPAWN_FALADOR")).findFirst().orElseThrow();
        assertEquals("Falador", falador.name);
        assertEquals("Respawn point", falador.group);
        assertEquals("Kourend & Kebos", catalog.diaries.stream().filter(diary -> diary.id.equals("KOUREND_KEBOS")).findFirst().orElseThrow().name);
    }
}

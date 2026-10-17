package shortestpath.routeapi;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CatalogTest {
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

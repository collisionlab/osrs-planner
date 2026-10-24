package shortestpath.workbench;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class BankCatalogTest {
    private static final String HEADER = "# Destination\tInfo\tSkills\tQuests\tVarbits\tVarPlayers\n";

    @Test
    void groupsTilesOfOneNameCloseTogetherIntoABank() {
        BankCatalog catalog = BankCatalog.parse(HEADER
            + "3185 3436 0\tVarrock\t\t\t\t\n"
            + "3186 3436 0\tVarrock\t\t\t\t\n"
            // Varrock's other bank, across the city.
            + "3253 3420 0\tVarrock\t\t\t\t\n"
            + "1399 2925 0\tAldarin\t\tChildren of the Sun\t\t\n"
            + "1399 2928 0\tAldarin\t\tChildren of the Sun\t\t\n"
            + "2096 3687 0\tBuccaneers' Haven\t50 Construction\t\t18369=1\t\n"
            // The same name upstairs isn't the same bank.
            + "3186 3436 1\tVarrock\t\t\t\t\n");
        List<BankCatalog.Bank> banks = catalog.banks();
        assertEquals(List.of("Varrock", "Varrock", "Aldarin", "Buccaneers' Haven", "Varrock"),
            banks.stream().map(bank -> bank.name).collect(Collectors.toList()));
        assertEquals(2, banks.get(0).tiles.size());
        assertEquals("varrock@3185,3436,0", banks.get(0).id);
        assertEquals(List.of("quest Children of the Sun"), banks.get(2).needs.stream().map(need -> need.kind + " " + need.name).collect(Collectors.toList()));
        assertEquals(List.of("skill 50 Construction", "var 18369=1"),
            banks.get(3).needs.stream().map(need -> need.kind + " " + need.name).collect(Collectors.toList()));
        assertTrue(banks.get(0).needs.isEmpty());
    }

    @Test
    void loadsTheBundledBanks() {
        List<BankCatalog.Bank> banks = BankCatalog.load().banks();
        assertTrue(banks.size() > 100, banks.size() + " banks");
        assertEquals(banks.size(), banks.stream().map(bank -> bank.id).distinct().count());
        assertEquals(2, banks.stream().filter(bank -> bank.name.equals("Varrock") && bank.tiles.get(0).plane == 0).count());
    }
}

package shortestpath.routeapi;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.Test;
import shortestpath.settings.TeleportationItem;
import shortestpath.pathfinder.PathfinderBackend;
import shortestpath.profiles.PluginSettings;

public class PlannerSettingsTest {
    @Test
    public void everyRoutingConfigItemIsASettingAndDisplayAndHouseItemsAreNot() {
        Set<String> keys = PlannerSettings.catalog().stream().map(setting -> setting.key).collect(Collectors.toSet());
        assertTrue(keys.containsAll(Set.of("useFairyRings", "costBoats", "useTeleportationItems", "currencyThreshold",
            "pathfinderBackend", "aStarHeuristicWeight", "costBankVisit")));
        // Unlocks the game doesn't report are account facts, not route settings.
        assertFalse(keys.contains("unlockCanoeAxe"));
        assertFalse(keys.contains("respawnPrifddinas"));
        assertFalse(keys.contains("drawMap"));
        assertFalse(keys.contains("usePohFairyRing"));
        assertFalse(keys.contains("pohJewelleryBoxTier"));
        assertFalse(keys.contains("useSeasonalTransports"));
    }

    @Test
    public void everySettingHasAGroupAndUnplacedOnesAreRefused() {
        Map<String, PlannerSettings.Group> groups = PlannerSettings.catalog().stream()
            .collect(Collectors.toMap(setting -> setting.key, setting -> setting.group));
        assertEquals(PlannerSettings.Group.EVERYDAY, groups.get("avoidWilderness"));
        assertEquals(PlannerSettings.Group.TRANSPORT, groups.get("useFairyRings"));
        assertEquals(PlannerSettings.Group.THRESHOLD, groups.get("costBoats"));
        assertEquals(PlannerSettings.Group.ADVANCED, groups.get("pathfinderBackend"));
        assertThrows(IllegalStateException.class, () -> PlannerSettings.group("drawNewThing", "Settings", boolean.class));
    }

    @Test
    public void jsonValuesOverrideThePlannerDefaults() {
        PluginSettings defaults = PlannerSettings.fromJson(null);
        assertEquals(PathfinderBackend.ASTAR, defaults.pathfinderBackend());
        assertFalse(defaults.isBypassVarbitChecks());
        assertEquals(TeleportationItem.INVENTORY_AND_BANK, defaults.useTeleportationItems());

        PluginSettings settings = PlannerSettings.fromJson(Map.of("useFairyRings", false, "costBoats", 12,
            "useTeleportationItems", "ALL"));
        assertFalse(settings.useFairyRings());
        assertEquals(12, settings.costBoats());
        assertEquals(TeleportationItem.ALL, settings.useTeleportationItems());
    }

    @Test
    public void unknownKeysAndWrongValuesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> PlannerSettings.fromJson(Map.of("drawMap", true)));
        assertThrows(IllegalArgumentException.class, () -> PlannerSettings.fromJson(Map.of("costBoats", "ten")));
        assertThrows(IllegalArgumentException.class,
            () -> PlannerSettings.fromJson(Map.of("useTeleportationItems", "EVERYTHING")));
    }
}

package shortestpath.routeapi;

import java.util.EnumMap;
import java.util.Map;
import shortestpath.accounts.Diary;
import shortestpath.accounts.Unlock;

/**
 * The names the planner shows for account facts whose enum names don't read as English: proper
 * nouns capitalised, and an unlock named without its group, which the editor already shows. Every
 * unlock needs one, so a new unlock fails {@link Catalog}'s test until it is named here.
 */
final class CatalogNames {
    private CatalogNames() { }

    static final Map<Unlock.Group, String> GROUPS = new EnumMap<>(Map.of(
        Unlock.Group.TRANSPORT, "Transport",
        Unlock.Group.BOOK_OF_SCROLLS, "Master scroll book",
        Unlock.Group.PENDANT_OF_ATES, "Pendant of Ates",
        Unlock.Group.HOT_AIR_BALLOON, "Hot air balloons",
        Unlock.Group.CATACOMBS, "Catacombs of Kourend",
        Unlock.Group.QUETZAL, "Quetzal landing sites",
        Unlock.Group.ROWBOAT, "Rowboats",
        Unlock.Group.RESPAWN, "Respawn point"));

    static final Map<Diary, String> DIARIES = new EnumMap<>(Map.of(
        Diary.KOUREND_KEBOS, "Kourend & Kebos",
        Diary.LUMBRIDGE_DRAYNOR, "Lumbridge & Draynor",
        Diary.WESTERN_PROVINCES, "Western Provinces"));

    static final Map<Unlock, String> UNLOCKS = unlocks();

    private static Map<Unlock, String> unlocks() {
        Map<Unlock, String> names = new EnumMap<>(Unlock.class);
        names.put(Unlock.FAIRY_RINGS, "Fairy rings");
        names.put(Unlock.RAIDS_MOUNTAIN_GUIDE_TRAVEL, "Mountain guide to the Chambers of Xeric");
        names.put(Unlock.MET_AUBURN_MOUNTAIN_GUIDE, "Met the Auburnvale mountain guide");
        names.put(Unlock.CORSAIR_COVE_RESOURCE_AREA, "Corsair Cove resource area");
        names.put(Unlock.LOST_TRIBE_CELLAR_HOLE, "Lumbridge cellar hole (The Lost Tribe)");
        names.put(Unlock.BARBARIAN_ASSAULT_TUTORIAL, "Barbarian Assault tutorial");
        names.put(Unlock.MUSEUM_KUDOS_153, "Varrock Museum, 153 kudos");
        names.put(Unlock.BARBARIAN_FIREMAKING_TRAINING, "Barbarian firemaking training");
        names.put(Unlock.FENKENSTRAIN_BRIDGE_NORTH, "Fenkenstrain's Castle bridge (north)");
        names.put(Unlock.FENKENSTRAIN_BRIDGE_SOUTH, "Fenkenstrain's Castle bridge (south)");
        names.put(Unlock.KARAMJA_DUNGEON_BACKDOOR, "Karamja dungeon back door");
        names.put(Unlock.OBSERVATORY_SHORTCUT_ROPE, "Observatory shortcut rope");
        names.put(Unlock.DWARVEN_MINE_CREVICE, "Dwarven Mine crevice");
        names.put(Unlock.HOSIDIUS_DUNGEON_WEST_DOOR, "Hosidius dungeon west door");
        names.put(Unlock.HOSIDIUS_DUNGEON_EAST_DOOR, "Hosidius dungeon east door");
        names.put(Unlock.DARKMEYER_INNER_SHORTCUT, "Darkmeyer inner shortcut");
        names.put(Unlock.DARKMEYER_OUTER_SHORTCUT, "Darkmeyer outer shortcut");
        names.put(Unlock.PHARAOHS_SCEPTRE_NECROPOLIS, "Pharaoh's sceptre to Necropolis");
        names.put(Unlock.COLOSSEUM_WAVE_NINE, "Fortis Colosseum wave 9");
        names.put(Unlock.SINS_OF_THE_FATHER_SLEPE_BOAT, "Slepe boat (Sins of the Father)");
        names.put(Unlock.LAND_OF_THE_GOBLINS_YU_BIUSK, "Yu'biusk (Land of the Goblins)");
        names.put(Unlock.ARCHITECTURAL_ALLIANCE, "Architectural Alliance");
        names.put(Unlock.TALE_OF_THE_RIGHTEOUS, "Tale of the Righteous");
        names.put(Unlock.BOOK_OF_SCROLLS_NARDAH, "Nardah");
        names.put(Unlock.BOOK_OF_SCROLLS_DIGSITE, "Digsite");
        names.put(Unlock.BOOK_OF_SCROLLS_FELDIP, "Feldip Hills");
        names.put(Unlock.BOOK_OF_SCROLLS_LUNAR_ISLE, "Lunar Isle");
        names.put(Unlock.BOOK_OF_SCROLLS_MORTTON, "Mort'ton");
        names.put(Unlock.BOOK_OF_SCROLLS_PEST_CONTROL, "Pest Control");
        names.put(Unlock.BOOK_OF_SCROLLS_PISCATORIS, "Piscatoris");
        names.put(Unlock.BOOK_OF_SCROLLS_TAI_BWO, "Tai Bwo Wannai");
        names.put(Unlock.BOOK_OF_SCROLLS_ELF, "Iorwerth Camp");
        names.put(Unlock.BOOK_OF_SCROLLS_MOS_LE_HARMLESS, "Mos Le'Harmless");
        names.put(Unlock.BOOK_OF_SCROLLS_LUMBERYARD, "Lumberyard");
        names.put(Unlock.BOOK_OF_SCROLLS_ZUL_ANDRA, "Zul-Andra");
        names.put(Unlock.BOOK_OF_SCROLLS_CERBERUS, "Key Master");
        names.put(Unlock.BOOK_OF_SCROLLS_REVENANTS, "Revenant Caves");
        names.put(Unlock.BOOK_OF_SCROLLS_WATSON, "Watson");
        names.put(Unlock.PENDANT_OF_ATES_DARKFROST, "Darkfrost");
        names.put(Unlock.PENDANT_OF_ATES_TWILIGHT, "Twilight Temple");
        names.put(Unlock.PENDANT_OF_ATES_RALOS, "Ralos' Rise");
        names.put(Unlock.PENDANT_OF_ATES_ALDARIN, "Aldarin");
        names.put(Unlock.BALLOON_ENTRANA, "Entrana");
        names.put(Unlock.BALLOON_TAVERLEY, "Taverley");
        names.put(Unlock.BALLOON_CASTLE_WARS, "Castle Wars");
        names.put(Unlock.BALLOON_GRAND_TREE, "Grand Tree");
        names.put(Unlock.BALLOON_CRAFTING_GUILD, "Crafting Guild");
        names.put(Unlock.BALLOON_VARROCK, "Varrock");
        names.put(Unlock.CATACOMBS_FORTHOS_DUNGEON, "Forthos Dungeon hole");
        names.put(Unlock.CATACOMBS_SURFACE_ENTRANCES, "Surface entrances");
        names.put(Unlock.CATACOMBS_GIANTS_DEN, "Giants' Den hole");
        names.put(Unlock.QUETZAL_CAM_TORUM, "Cam Torum");
        names.put(Unlock.QUETZAL_COLOSSAL_WYRM_REMAINS, "Colossal Wyrm Remains");
        names.put(Unlock.QUETZAL_OUTER_FORTIS, "Outer Fortis");
        names.put(Unlock.QUETZAL_FORTIS_COLOSSEUM, "Fortis Colosseum");
        names.put(Unlock.QUETZAL_SALVAGER_OVERLOOK, "Salvager Overlook");
        names.put(Unlock.QUETZAL_KASTORI, "Kastori");
        names.put(Unlock.ROWBOAT_VATRACHOS, "Vatrachos");
        names.put(Unlock.ROWBOAT_ANGLERS, "The Anglers' Retreat");
        names.put(Unlock.ROWBOAT_SOUL_TEAR, "Soul Tear");
        names.put(Unlock.ROWBOAT_YNYSDAIL, "Ynysdail");
        names.put(Unlock.ROWBOAT_BUCCANEERS, "Buccaneers' Haven");
        names.put(Unlock.RESPAWN_FALADOR, "Falador");
        names.put(Unlock.RESPAWN_CAMELOT, "Camelot");
        names.put(Unlock.RESPAWN_EDGEVILLE, "Edgeville");
        names.put(Unlock.RESPAWN_FEROX_ENCLAVE, "Ferox Enclave");
        names.put(Unlock.RESPAWN_KOUREND_CASTLE, "Kourend Castle");
        names.put(Unlock.RESPAWN_CIVITAS_ILLA_FORTIS, "Civitas illa Fortis");
        return names;
    }
}

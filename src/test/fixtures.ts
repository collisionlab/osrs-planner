import type { Account, Catalog, Setting } from "../domain/contracts";
import type { PlannerAccount } from "../domain/accounts";

const setting = (key: string, name: string, type: Setting["type"], defaultValue: Setting["defaultValue"], group: Setting["group"],
  choices?: Setting["choices"]): Setting => ({ key, name, description: name, group, type, defaultValue,
  section: group === "THRESHOLD" ? "Transport Thresholds" : "Settings", ...choices ? { choices } : {} });

/** A small slice of the route service's catalog. */
export const catalog: Catalog = {
  skills: [{ id: "AGILITY", name: "Agility" }, { id: "ATTACK", name: "Attack" }],
  quests: [{ id: "LOST_CITY", name: "Lost City" }, { id: "DRAGON_SLAYER_I", name: "Dragon Slayer I" }],
  diaries: [{ id: "ARDOUGNE", name: "Ardougne" }, { id: "VARROCK", name: "Varrock" }],
  diaryTiers: ["NONE", "EASY", "MEDIUM", "HARD", "ELITE"].map(id => ({ id, name: id[0] + id.slice(1).toLowerCase() })),
  unlocks: [
    { id: "FAIRY_RINGS", name: "Fairy rings", group: "Transport" },
    { id: "BALLOON_ENTRANA", name: "Entrana", group: "Hot air balloons" },
    { id: "RESPAWN_FALADOR", name: "Falador", group: "Respawn point" },
    { id: "RESPAWN_EDGEVILLE", name: "Edgeville", group: "Respawn point" },
    { id: "RESPAWN_PRIFDDINAS", name: "Prifddinas", group: "Respawn point" },
    { id: "CANOE_AXE_STORED", name: "Axe stored at a canoe station", group: "Transport" },
  ],
  spellbooks: ["STANDARD", "ANCIENT", "LUNAR", "ARCEUUS"].map(id => ({ id, name: id[0] + id.slice(1).toLowerCase() })),
  houseLocations: [{ id: "RIMMINGTON", name: "Rimmington" }, { id: "YANILLE", name: "Yanille" }],
  jewelleryBoxes: ["NONE", "FANCY", "ORNATE"].map(id => ({ id, name: id[0] + id.slice(1).toLowerCase() })),
  portals: [{ id: "Varrock Portal", name: "Varrock" }],
  plantedSpiritTrees: [{ id: "FARMING_GUILD", name: "Farming Guild" }],
  settings: [
    setting("avoidWilderness", "Avoid wilderness", "boolean", true, "EVERYDAY"),
    setting("includeBankPath", "Include path to bank", "boolean", true, "EVERYDAY"),
    setting("useTeleportationItems", "Use teleportation items", "choice", "INVENTORY_AND_BANK", "EVERYDAY",
      [{ id: "NONE", name: "None" }, { id: "INVENTORY_AND_BANK", name: "Inventory and bank" }, { id: "ALL", name: "All" }]),
    setting("useFairyRings", "Use fairy rings", "boolean", true, "TRANSPORT"),
    setting("costBoats", "Boat threshold", "integer", 0, "THRESHOLD"),
    setting("currencyThreshold", "Currency threshold", "integer", 2147483647, "ADVANCED"),
    setting("pathfinderBackend", "Pathfinder algorithm", "choice", "ASTAR", "ADVANCED",
      [{ id: "LEGACY", name: "Legacy" }, { id: "ASTAR", name: "A*" }]),
  ],
};

export const account: Account = {
  name: "Mid game",
  levels: { AGILITY: 70, ATTACK: 60 },
  questPoints: 50,
  completedQuests: ["LOST_CITY"],
  diaries: { ARDOUGNE: "MEDIUM" },
  unlocks: ["FAIRY_RINGS"],
  spellbook: "STANDARD",
  nowMinutes: 100000000,
  inventory: { "995": 10 }, runePouch: {}, equipment: {}, bank: {},
  house: {
    location: "RIMMINGTON", jewelleryBox: "NONE", fairyRing: false, spiritTree: false, obelisk: false,
    mountedGlory: false, mountedXerics: false, mountedDigsite: false, mountedMythical: false, portals: [],
  },
  plantedSpiritTrees: [],
};

export const presets: PlannerAccount[] = [
  { id: "mid", name: "Mid game", account },
  { id: "maxed", name: "Maxed", account: { ...account, name: "Maxed" } },
];

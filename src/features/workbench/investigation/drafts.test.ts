import { describe, expect, it } from "vitest";
import { areaKey, correctionDraft, transportDraft, INVESTIGATE } from "./drafts";
import { regions } from "./testRelease";

const shapes = new Map(regions.map(region => [region.id, region]));
const tile = (x: number, y: number, plane = 0) => ({ x, y, plane });

describe("drafts", () => {
  it("drafts a transport row knowing only its tiles", () => {
    const draft = transportDraft(tile(101, 10001), tile(3000, 3000));
    expect(draft.fields.Origin).toBe("101 10001 0");
    expect(draft.unknown).toEqual(["menuOption menuTarget objectID", "Skills", "Items", "Quests", "Varbits", "VarPlayers", "Duration"]);
    expect(draft.tsv.split("\n")[0]).toBe("# Origin\tDestination\tmenuOption menuTarget objectID\tSkills\tItems\tQuests\tVarbits\tVarPlayers\tDuration\tDisplay info");
    expect(draft.tsv.split("\n")[1].split("\t").filter(field => field.startsWith(INVESTIGATE))).toHaveLength(7);
    // What the developer saw is used, and only that.
    const seen = transportDraft(tile(1, 1), tile(2, 2), { action: "Climb-up Ladder", objectId: "16683" });
    expect(seen.fields["menuOption menuTarget objectID"]).toBe("Climb-up Ladder 16683");
    expect(seen.unknown).not.toContain("menuOption menuTarget objectID");
    expect(transportDraft(tile(1, 1), tile(2, 2), { action: "Climb-up Ladder" }).fields["menuOption menuTarget objectID"]).toMatch(/^INVESTIGATE\(.*seen: Climb-up Ladder\)$/);
  });

  it("drafts an annotation only once name, region, seed, evidence and reason are given", () => {
    const input = { key: "lost-cellar", name: "Lost Cellar", status: "named" as const, regionId: "lost", seed: tile(305, 10005), evidence: ["s-9"], justification: "A label inside it." };
    expect(correctionDraft(input, shapes)).toEqual({ problems: [], draft: { key: "lost-cellar", name: "Lost Cellar", status: "named", reason: "A label inside it.",
      components: [{ componentId: "lost", seed: [305, 10005, 0], evidence: ["s-9"], reason: "A label inside it." }] } });
    expect(correctionDraft({ ...input, evidence: [] }, shapes).problems).toEqual(["Choose the evidence the name rests on; none is chosen for you."]);
    expect(correctionDraft({ ...input, seed: tile(100, 10000) }, shapes).problems[0]).toMatch(/not on lost's terrain/);
    expect(correctionDraft({ ...input, key: "Lost Cellar" }, shapes).problems[0]).toMatch(/area key/);
    expect(correctionDraft({ ...input, anchor: { point: tile(3000, 3000), reason: "", entrance: true } }, shapes).problems).toEqual(["Say why the area hangs off the anchor's point."]);
    expect(correctionDraft({ ...input, anchor: { point: tile(3000, 3000), reason: "Its trapdoor.", entrance: true } }, shapes).draft!.components[0].anchor)
      .toEqual({ point: [3000, 3000, 0], reason: "Its trapdoor.", entrance: true });
    expect(areaKey("Abandoned Mine – level 1")).toBe("abandoned-mine-level-1");
    expect(areaKey("Cerberus' Lair")).toBe("cerberus-lair");
  });
});

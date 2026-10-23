import { describe, expect, it } from "vitest";
import { buildInvestigation, evidenceOf, filterAreas } from "./data";
import { anchors, HASH, investigations, release } from "./testRelease";

describe("inset investigation data", () => {
  it("makes areas from the release's labels when it has no investigations.json", () => {
    const data = buildInvestigation(release(), anchors());
    expect(data.investigations.state).toBe("absent");
    const dungeon = data.byId.get("area:dungeon")!;
    expect(dungeon).toMatchObject({ status: "named", areaKey: "dungeon", regionIds: ["dun-a", "dun-b"], planes: [0, 1], entrance: true, reachable: true, aliases: ["The Dungeon"] });
    // Named but placed by nothing: the release's own fact, not a guess.
    expect(dungeon.issues).toEqual([expect.objectContaining({ code: "no-anchor", regionId: "dun-b", source: "release" })]);
    expect(data.byId.get("region:dun-c")!.issues).toEqual([expect.objectContaining({ code: "unnamed-reachable", severity: "error" })]);
    expect(data.byId.get("region:lost")).toMatchObject({ status: "provisional", entrance: false, anchored: false, reachable: false, issues: [] });
    // Joined by a connection.
    expect(dungeon.relatedAreaIds).toEqual(["region:dun-c"]);
    // Worst first: the reachable unnamed room, then the dungeon's warning, then the rest.
    expect(data.areas.map(area => area.id)).toEqual(["region:dun-c", "area:dungeon", "region:lost"]);
  });

  it("uses a matching investigations.json, with its suggestions kept apart from accepted evidence", () => {
    const data = buildInvestigation(release(), anchors(), undefined, investigations());
    expect(data.investigations.state).toBe("loaded");
    expect(data.areas.map(area => area.id)).toEqual(["region:lost", "area:dungeon"]);
    expect(data.plugin?.rev).toBe("a".repeat(40));
    expect(evidenceOf(data, "s-9")).toMatchObject({ name: "Lost Cellar", accepted: false });
    expect(evidenceOf(data, "s-1")).toMatchObject({ accepted: true });
    // A matched connection stands as evidence of where it arrives.
    expect(evidenceOf(data, "c-1")).toMatchObject({ kind: "connection", point: [101, 10001, 0], source: "transports.tsv:12" });
    expect(data.areasOfRegion.get("dun-b")).toEqual(["area:dungeon"]);
  });

  it("refuses investigations.json made from another release or naming what isn't there", () => {
    const refused = (change: (file: ReturnType<typeof investigations>) => void) => {
      const file = investigations(); change(file);
      const data = buildInvestigation(release(), anchors(), undefined, file);
      expect(data.investigations.state).toBe("invalid");
      expect(data.areas.map(area => area.id)).toContain("region:dun-c"); // back to the labels
      return data.investigations.state === "invalid" ? data.investigations.reason : "";
    };
    expect(refused(file => { file.labelsSha256 = "1".repeat(64); })).toMatch(/another labels.json/);
    expect(refused(file => { file.areas[0].regionIds = ["gone"]; })).toMatch(/region gone/);
    expect(refused(file => { file.areas[0].candidates[0].evidence = ["s-unknown"]; })).toMatch(/evidence s-unknown/);
    expect(refused(file => { file.areas[1].relatedAreaIds = ["area:nowhere"]; })).toMatch(/area:nowhere/);
    expect(refused(file => { (file as { schemaVersion: number }).schemaVersion = 2; })).toMatch(/schema 1/);
    expect(buildInvestigation(release(), anchors(), undefined, undefined, "investigations.json is not the file this release's manifest lists").investigations)
      .toEqual({ state: "invalid", reason: "investigations.json is not the file this release's manifest lists" });
  });

  it("refuses anchors from another catalogue", () => {
    expect(() => buildInvestigation(release(), { ...anchors(), catalogueSha256: "1".repeat(64) })).toThrow(/another regions.json/);
    expect(HASH).toHaveLength(64);
  });

  it("filters by status, plane, size, text and outstanding work", () => {
    const { areas } = buildInvestigation(release(), anchors());
    const ids = (filter: Parameters<typeof filterAreas>[1]) => filterAreas(areas, filter).map(area => area.id);
    expect(ids({ status: "provisional" })).toEqual(["region:dun-c", "region:lost"]);
    expect(ids({ plane: 1 })).toEqual(["area:dungeon"]);
    expect(ids({ minTiles: 400 })).toEqual(["area:dungeon", "region:lost"]);
    expect(ids({ text: "the dungeon" })).toEqual(["area:dungeon"]);
    expect(ids({ text: "dun-b" })).toEqual(["area:dungeon"]);
    expect(ids({ flag: "multi-floor" })).toEqual(["area:dungeon"]);
    expect(ids({ flag: "no-entrance" })).toEqual(["region:dun-c", "region:lost"]);
    expect(ids({ flag: "issues" })).toEqual(["region:dun-c", "area:dungeon"]);
    expect(filterAreas(areas, { flag: "topology" }, new Set(["region:lost"])).map(area => area.id)).toEqual(["region:lost"]);
  });
});

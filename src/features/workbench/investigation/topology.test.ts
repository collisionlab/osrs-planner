import { describe, expect, it } from "vitest";
import { catalogueClassifier } from "../../../map/insets/preview";
import { buildInvestigation } from "./data";
import { anchors, regions, release } from "./testRelease";
import { areaTopology, checkReport, componentHolds, gapAreas, reportChecks, type TopologyReport } from "./topology";

const component = (id: string, x: number, extra: Partial<TopologyReport["components"][number]> = {}) => ({ id, plane: 0, bounds: [x, 10000, x + 5, 10005] as [number, number, number, number],
  tileCount: 36, samples: [[x + 1, 10001, 0]] as [number, number, number][], reachable: true, significant: true, transports: { incoming: 1, outgoing: 1 }, ...extra });
const report = (): TopologyReport => ({
  schemaVersion: 1, generator: { repository: "t/tooling", rev: "b".repeat(40) }, plugin: { repository: "Skretzo/shortest-path", rev: "a".repeat(40) },
  collision: { cacheId: 2746, dumperRev: "b".repeat(40) }, origin: [3221, 3218, 0], reachability: "reached from Lumbridge.",
  components: [component("main", 100), component("side", 110), component("pocket", 112, { reachable: false, mask: [[112, 10000, 3, 3]] }),
    component("speck", 118, { significant: false, tileCount: 1 }), component("far", 300, { reachable: false })],
  candidates: [{ id: "k-1", from: { point: [113, 10001, 0], componentId: "pocket" }, to: { point: [105, 10005, 1] }, support: "insufficient", reasons: [], evidence: [], sources: [] }],
  suspiciousEndpoints: [{ id: "e-1", point: [101, 10001, 0], role: "destination", label: "Ladder", reasons: ["destination-blocked"], sources: [{ file: "transports.tsv", line: 12 }] }],
});

describe("topology report", () => {
  it("checks the report's shape and its own references", () => {
    expect(checkReport(report()).components).toHaveLength(5);
    expect(() => checkReport({ ...report(), schemaVersion: 2 })).toThrow(/schema 1/);
    const dangling = report(); dangling.candidates[0].to.componentId = "nowhere";
    expect(() => checkReport(dangling)).toThrow(/component nowhere/);
  });

  it("is verified only when it was made from the same cache, transports and collision", () => {
    const same = { cacheId: 2746, plugin: { repository: "Skretzo/shortest-path", rev: "a".repeat(40) }, collisionDumperRev: "b".repeat(40) };
    expect(reportChecks(report(), same).verified).toBe(true);
    const otherCache = reportChecks(report(), { ...same, cacheId: 2700 });
    expect(otherCache.verified).toBe(false);
    expect(otherCache.checks.find(check => check.subject === "Cache")!.text).toMatch(/cut from cache 2700/);
    expect(reportChecks(report(), { ...same, plugin: { repository: "Skretzo/shortest-path", rev: "c".repeat(40) } }).verified).toBe(false);
    // Unknown is not verified either.
    expect(reportChecks(report(), { cacheId: 2746 }).verified).toBe(false);
  });

  it("finds an area's components by its regions' tiles, leaving fragments and other areas out", () => {
    const data = buildInvestigation(release(), anchors());
    const topology = areaTopology(report(), data.byId.get("area:dungeon")!, data.regions);
    expect(topology.components.map(({ component, overlap }) => [component.id, overlap])).toEqual([["pocket", "tiles"], ["main", "tiles"], ["side", "tiles"]]);
    expect(topology.fragments).toBe(1);
    expect(topology.candidates.map(candidate => candidate.id)).toEqual(["k-1"]);
    expect(topology.suspects.map(suspect => suspect.id)).toEqual(["e-1"]);
  });

  it("says where a tile's component is known exactly and where only by bounds", () => {
    const [main, , pocket] = report().components;
    expect(componentHolds(main, { x: 101, y: 10001, plane: 0 })).toBe("tile");
    expect(componentHolds(main, { x: 103, y: 10003, plane: 0 })).toBe("bounds");
    expect(componentHolds(pocket, { x: 116, y: 10004, plane: 0 })).toBeUndefined();
    expect(componentHolds(main, { x: 101, y: 10001, plane: 1 })).toBeUndefined();
  });

  it("marks areas with a candidate or an unreached significant component as possible gaps", () => {
    const data = buildInvestigation(release(), anchors());
    const classify = catalogueClassifier({ regions, surfaceRects: [[0, 3000, 3000, 1000, 1000]] });
    expect([...gapAreas(report(), data.areasOfRegion, classify)].sort()).toEqual(["area:dungeon", "region:lost"]);
  });
});

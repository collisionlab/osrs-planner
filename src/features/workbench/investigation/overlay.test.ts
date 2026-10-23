import { describe, expect, it } from "vitest";
import { catalogueClassifier } from "../../../map/insets/preview";
import { buildInvestigation } from "./data";
import { investigationOverlay, key, regionEntrance } from "./overlay";
import { anchors, regions, release } from "./testRelease";

const data = buildInvestigation(release(), anchors(), undefined, undefined);
const classify = catalogueClassifier({ regions, surfaceRects: [[0, 2900, 2900, 200, 200]] });
const base = { data, classify, beside: false, mode: "labelling" as const, plane: 0 };

describe("investigation overlay", () => {
  it("shows an area's regions on the plane shown by their masks, in place unless asked", () => {
    const area = data.byId.get("area:dungeon")!;
    const overlay = investigationOverlay({ ...base, area, region: "dun-a" });
    expect(overlay.regions).toEqual([{ regionId: "dun-a" }]);
    expect(overlay.features.filter(feature => feature.kind === "mask")).toEqual([{ kind: "mask", key: key.region("dun-a"), regionId: "dun-a", tone: "area", strong: true }]);
    expect(investigationOverlay({ ...base, area, plane: 1 }).regions).toEqual([{ regionId: "dun-b" }]);
    // Beside its entrance where one is known; a region without one stays where it is.
    expect(investigationOverlay({ ...base, area, beside: true }).regions).toEqual([{ regionId: "dun-a",
      entrance: { surface: { x: 3000, y: 3000, plane: 0 }, inside: { x: 101, y: 10001, plane: 0 }, wayIn: true } }]);
    expect(investigationOverlay({ ...base, area, plane: 1, beside: true }).regions).toEqual([{ regionId: "dun-b" }]);
    expect(regionEntrance(data.anchors, "lost")).toBeUndefined();
  });

  it("marks labelling's seeds, evidence and anchors, and no edges", () => {
    const overlay = investigationOverlay({ ...base, area: data.byId.get("area:dungeon")! });
    expect(overlay.features.filter(feature => feature.kind === "edge")).toEqual([]);
    expect(overlay.features.map(feature => feature.key)).toEqual(expect.arrayContaining([key.region("dun-a"), key.evidence("s-1"), key.anchor("dun-a", 0)]));
    expect(overlay.anchors).toEqual([]);
  });

  it("anchors a selected candidate's ends and lays out the regions they are in, in either mode", () => {
    const candidate = { id: "k-1", from: { point: [105, 10005, 0] as [number, number, number] }, to: { point: [305, 10005, 0] as [number, number, number] },
      support: "insufficient" as const, reasons: [], evidence: [], sources: [] };
    const area = data.byId.get("area:dungeon")!;
    const topology = { components: [], fragments: 0, candidates: [candidate], suspects: [] };
    const overlay = investigationOverlay({ ...base, mode: "topology", area, topology, candidate, item: key.candidate("k-1") });
    expect(overlay.features).toContainEqual({ kind: "edge", key: "cand:k-1", from: { x: 105, y: 10005, plane: 0 }, to: { x: 305, y: 10005, plane: 0 }, tone: "candidate", dashed: true });
    expect(overlay.anchors.map(feature => feature.kind)).toEqual(["point", "point"]);
    expect(overlay.regions).toEqual([{ regionId: "dun-a" }, { regionId: "lost" }]);
    expect(investigationOverlay({ ...base, area, candidate, item: key.candidate("k-1") }).regions).toEqual([{ regionId: "dun-a" }, { regionId: "lost" }]);
    // An end on another floor of the same tiles goes beside them, not over them.
    const upstairs = { ...candidate, to: { point: [105, 10005, 1] as [number, number, number] } };
    expect(investigationOverlay({ ...base, area, candidate: upstairs, item: key.candidate("k-1") }).regions).toEqual([{ regionId: "dun-a" }, { regionId: "dun-b", aside: true }]);
  });
});

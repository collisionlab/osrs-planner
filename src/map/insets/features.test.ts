import { describe, expect, it } from "vitest";
import { anchorsKey, edgeLinks, featurePoints, featuresOf, keysHit, layoutKey, type MapFeature } from "./features";

const p = (x: number, y: number, plane = 0) => ({ x, y, plane });
const door: MapFeature = { kind: "edge", key: "door", from: p(10, 10), to: p(12, 10), tone: "object" };
const cave: MapFeature = { kind: "edge", key: "cave", from: p(10, 10), to: p(500, 9000), tone: "object" };
const landing: MapFeature = { kind: "point", key: "tele", point: p(20, 20), tone: "teleport", role: "destination" };
const counted: MapFeature = { kind: "region", key: "area", plane: 1, bounds: [0, 0, 63, 63], tone: "area", label: "12" };
const classify = (point: { y: number }) => point.y > 6000 ? "cave" : "main-world";

describe("map features", () => {
  it("gives each kind its tiles", () => {
    expect(featurePoints(door)).toEqual([p(10, 10), p(12, 10)]);
    expect(featurePoints(landing)).toEqual([p(20, 20)]);
    expect(featurePoints(counted)).toEqual([p(0, 0, 1), p(63, 63, 1)]);
  });

  it("selects an item's features and names the items under a click once each", () => {
    const features = [door, landing, { ...landing, role: "origin" as const }];
    expect(featuresOf(features, "tele")).toHaveLength(2);
    expect(featuresOf(features, undefined)).toEqual([]);
    expect(keysHit([{ key: "tele" }, { key: "door" }, { key: "tele" }, {}])).toEqual(["tele", "door"]);
  });

  it("turns edges between areas into crossings that place one beside the other", () => {
    expect(edgeLinks([door, cave, landing], classify)).toEqual([
      { fromRegion: "main-world", toRegion: "cave", source: { kind: "transport", from: p(10, 10), to: p(500, 9000) } }]);
  });

  it("lays out again only when the anchors move", () => {
    const base = { features: [door, landing], anchors: [door] };
    expect(anchorsKey(base)).toBe(anchorsKey({ ...base, features: [door], selected: "door" }));
    expect(anchorsKey(base)).not.toBe(anchorsKey({ ...base, anchors: [cave] }));
    expect(anchorsKey(undefined)).toBe("");
  });

  it("lays the insets out again only when the anchors reach other areas, or enter one elsewhere", () => {
    const on = (anchors: MapFeature[]) => layoutKey({ features: anchors, anchors }, classify);
    const otherDoor: MapFeature = { ...door, from: p(40, 40), to: p(41, 40) };
    expect(on([door])).toBe(on([otherDoor]));
    expect(on([door])).not.toBe(on([cave]));
    expect(on([cave])).not.toBe(on([{ ...cave, from: p(11, 10) }]));
    expect(on([{ ...landing, point: p(20, 20, 1) }])).not.toBe(on([landing]));
  });

  it("lays out again for other regions, but not for anchors inside regions already listed", () => {
    const inCave: MapFeature = { kind: "point", key: "tile", point: p(500, 9000), tone: "entrance", role: "origin" };
    const listed = { features: [], anchors: [], regions: [{ regionId: "cave" }] };
    expect(layoutKey(listed, classify)).toBe(layoutKey({ ...listed, anchors: [inCave] }, classify));
    expect(layoutKey(listed, classify)).not.toBe(layoutKey({ ...listed, regions: [{ regionId: "cave", entrance: { surface: p(1, 1), inside: p(500, 9000), wayIn: true } }] }, classify));
    expect(featurePoints({ kind: "mask", key: "m", regionId: "cave", tone: "area" })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { anchorsKey, edgeLinks, featurePoints, featuresOf, keysHit, type MapFeature } from "./features";

const p = (x: number, y: number, plane = 0) => ({ x, y, plane });
const door: MapFeature = { kind: "edge", key: "door", from: p(10, 10), to: p(12, 10), tone: "object" };
const cave: MapFeature = { kind: "edge", key: "cave", from: p(10, 10), to: p(500, 9000), tone: "object" };
const landing: MapFeature = { kind: "point", key: "tele", point: p(20, 20), tone: "teleport", role: "destination" };
const counted: MapFeature = { kind: "region", key: "count", plane: 1, bounds: [0, 0, 63, 63], tone: "count", label: "12" };
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
});

import { describe, expect, it } from "vitest";
import type { Region } from "../../map/insets/geometry";
import type { UnreachedArea } from "../../map/insets/routing";
import { areaBox, areaFeatures, areaId, listed, mapRegions, undergroundMaps, type WorldMap } from "./underground";

const waterbirth: WorldMap = { name: "Waterbirth Dungeon", safeName: "waterbirth", rects: [[0, 2432, 10112, 64, 64], [1, 2432, 10112, 64, 64]] };
const ancient: WorldMap = { name: "Ancient Cavern", safeName: "ancient_cavern", rects: [[0, 1728, 5312, 64, 64]] };
const area = (tiles: number, x: number, y: number, plane = 0): UnreachedArea =>
  ({ plane, tiles, bounds: [x, y, x + 10, y + 5], representative: [x, y, plane] });

describe("underground areas", () => {
  const entrance = area(1542, 2466, 10140), fragment = area(3, 2470, 10150), upstairs = area(40, 2440, 10120, 1);
  const surface = area(500, 3200, 3200), cavern = area(276, 1747, 5330);
  const maps = undergroundMaps([waterbirth, ancient], [fragment, surface, entrance, upstairs, cavern]);

  it("puts each area in the maps that draw its representative tile, largest first, maps by name", () => {
    expect(maps.map(map => map.name)).toEqual(["Ancient Cavern", "Waterbirth Dungeon"]);
    expect(maps[1].areas).toEqual([entrance, upstairs, fragment]);
    expect(maps[1].tiles).toBe(1585);
    expect(maps[1].planes).toEqual([0, 1]);
    expect(maps[0].areas).toEqual([cavern]);
  });

  it("lists areas of 20 tiles or more and draws those on the plane shown", () => {
    expect(listed(maps[1])).toEqual([entrance, upstairs]);
    expect(areaFeatures(maps[1], 0)).toEqual([{ kind: "region", key: "2466_10140_0", plane: 0, tone: "suspect", dashed: true,
      bounds: [2466, 10140, 2475, 10144], label: "1,542 tiles" }]);
    expect(areaId(upstairs)).toBe("2440_10120_1");
  });

  it("frames an area's bounds inclusively", () => {
    expect(areaBox(entrance)).toEqual({ plane: 0, x1: 2466, y1: 10140, x2: 2475, y2: 10144, reference: { x: 2466, y: 10140, plane: 0 } });
  });

  it("shows the inset regions with terrain in the map's tiles on the plane, never the main map's", () => {
    const region = (id: string, plane: number, x: number, y: number, classification: Region["classification"] = "inset"): Region =>
      ({ id, plane, bounds: [x, y, x + 8, y + 8], tileCount: 64, mask: [[x, y, 8, 8]], classification, surfaceTiles: 0, touchesUnknown: false, examples: [] });
    const regions = [region("in", 0, 2490, 10170), region("upstairs", 1, 2440, 10120), region("outside", 0, 2496, 10112),
      region("surface", 0, 2440, 10120, "main-world")];
    expect(mapRegions(waterbirth, 0, regions).map(r => r.id)).toEqual(["in"]);
    expect(mapRegions(waterbirth, 1, regions).map(r => r.id)).toEqual(["upstairs"]);
  });
});

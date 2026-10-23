import { describe, expect, it } from "vitest";
import { mapToWorld, tileAddress, visibleBoxes, worldToMap } from "./projection";

describe("OSRS projection", () => {
  it("round-trips canonical tile coordinates", () => {
    const grandExchange = { x: 3165, y: 3487, plane: 0 };
    expect(mapToWorld(worldToMap(grandExchange), grandExchange.plane)).toEqual(grandExchange);
  });

  it("matches known production TMS tile addresses", () => {
    expect(tileAddress({ x: 3165, y: 3487, plane: 0 }, 11)).toEqual({ z: 11, x: 275, y: 283 });
    expect(tileAddress({ x: 2836, y: 10207, plane: 0 }, 11)).toEqual({ z: 11, x: 234, y: 1123 });
  });

  it("finds the world tiles in view on the surface and in each inset, wherever it was moved", () => {
    const a = worldToMap({ x: 3200, y: 3200, plane: 0 }), b = worldToMap({ x: 3240, y: 3230, plane: 0 });
    const extent = [a[0], a[1], b[0], b[1]];
    const surface = { plane: 0, bounds: [1000, 2000, 4000, 4000] as [number, number, number, number], offset: [0, 0] };
    // A dungeon at (2800-2900, 9500-9600) drawn so its corner sits at (3210, 3210) on the map.
    const cave = worldToMap({ x: 2800, y: 9500, plane: 0 }), at = worldToMap({ x: 3210, y: 3210, plane: 0 });
    const inset = { plane: 0, bounds: [2800, 9500, 2900, 9600] as [number, number, number, number], offset: [at[0] - cave[0], at[1] - cave[1]] };
    const away = { plane: 1, bounds: [100, 100, 200, 200] as [number, number, number, number], offset: [0, 0] };
    expect(visibleBoxes(extent, [surface, inset, away])).toEqual([
      { plane: 0, x1: 3200, y1: 3200, x2: 3240, y2: 3230 },
      { plane: 0, x1: 2800, y1: 9500, x2: 2830, y2: 9520 },
    ]);
  });
});

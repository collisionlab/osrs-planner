import { afterEach, describe, expect, it, vi } from "vitest";
import { CollisionMap, releaseTiles } from "./collision";

/** One plane of a map square as the tiles release writes it, with the given flags set. */
function plane(set: [x: number, y: number, flag: number][]) {
  const bytes = new Uint8Array(64 * 64 * 4 / 8);
  for (const [x, y, flag] of set) { const bit = (y * 64 + x) * 4 + flag; bytes[bit >> 3] |= 1 << (bit & 7); }
  return bytes;
}

afterEach(() => vi.unstubAllGlobals());

describe("collision map", () => {
  it("reads open edges, walls and blocked tiles as the plugin's SplitFlagMap does", async () => {
    // In map square 50_50 (3200, 3200): (3201, 3201) opens north and east; the tile north of it
    // opens only back south, through its neighbour's north flag; (3210, 3210) is shut in.
    const collision = new CollisionMap(async (square, p) => square.x === 50 && square.y === 50 && p === 0
      ? plane([[1, 1, 0], [1, 1, 1], [10, 9, 3]]) : null);
    await collision.load([{ x: 3201, y: 3201, plane: 0 }, { x: 3201, y: 3201, plane: 1 }], 2);
    expect(collision.tile({ x: 3201, y: 3201, plane: 0 })).toMatchObject({ north: true, east: true, south: false, west: false, blocked: false });
    expect(collision.tile({ x: 3201, y: 3202, plane: 0 })).toMatchObject({ south: true, blocked: false });
    expect(collision.tile({ x: 3210, y: 3210, plane: 0 })).toMatchObject({ blocked: true });
    expect(collision.tile({ x: 3210, y: 3209, plane: 0 })).toMatchObject({ wallEast: true });
    // A plane with no walkable tile has no file, and is drawn as nothing rather than all blocked.
    expect(collision.tile({ x: 3201, y: 3201, plane: 1 })).toBeUndefined();
    expect(collision.tile({ x: 100, y: 100, plane: 0 })).toBeUndefined();
  });

  it("fetches a plane of a square from the tile address of the release's collision layer", async () => {
    const fetch = vi.fn(async (url: string) => new Response(url.includes("/p1/") ? null : new Uint8Array(2048), { status: url.includes("/p1/") ? 404 : 200 }));
    vi.stubGlobal("fetch", fetch);
    const tiles = releaseTiles("https://tiles.example", "2746-abc");
    expect(await tiles({ x: 50, y: 53 }, 0)).toHaveLength(2048);
    expect(fetch).toHaveBeenLastCalledWith("https://tiles.example/collision/2746-abc/8/35/34.bin", expect.anything());
    expect(await tiles({ x: 50, y: 53 }, 1)).toBeNull();
    expect(fetch).toHaveBeenLastCalledWith("https://tiles.example/collision/2746-abc/p1/8/35/34.bin", expect.anything());
  });
});

import type { WorldPoint } from "../../domain/contracts";

/**
 * The plugin's collision map as the tiles release publishes it (osrs-tiles `docs/tiles.md`): one file
 * per map square and plane at the zoom-8 tile address, 64 × 64 tiles × 4 flags, as the plugin's
 * `SplitFlagMap` reads them: whether the tile's north and east edges are open, and whether those
 * edges are walls or doors rather than objects.
 */

const SIZE = 64, FLAGS = 4;
const NORTH = 0, EAST = 1, WALL_NORTH = 2, WALL_EAST = 3;
/** Map square of tile (0, 0) at zoom 8, as for the image tiles. */
const ORIGIN_X = 15, ORIGIN_Y = 19;

export interface TileCollision {
  /** No way in or out: every edge closed. */
  blocked: boolean;
  north: boolean; east: boolean; south: boolean; west: boolean;
  /** The closed north/east edge is a wall or door. */
  wallNorth: boolean; wallEast: boolean;
}

export class CollisionMap {
  private readonly tiles = new Map<string, Uint8Array | null>();

  /** `fetchTile` returns a square's plane, or `null` where it has no walkable tile (no file). */
  constructor(private readonly fetchTile: (square: { x: number; y: number }, plane: number, signal?: AbortSignal) => Promise<Uint8Array | null>) {}

  /** Fetch every square within `radius` tiles of the points, on the points' planes. */
  async load(points: WorldPoint[], radius: number, signal?: AbortSignal) {
    const wanted = new Map<string, [{ x: number; y: number }, number]>();
    for (const { x, y, plane } of points) {
      for (let sx = (x - radius) >> 6; sx <= (x + radius) >> 6; sx++) for (let sy = (y - radius) >> 6; sy <= (y + radius) >> 6; sy++) {
        wanted.set(key(sx, sy, plane), [{ x: sx, y: sy }, plane]);
      }
    }
    await Promise.all([...wanted].filter(([name]) => !this.tiles.has(name)).map(async ([name, [square, plane]]) => {
      this.tiles.set(name, await this.fetchTile(square, plane, signal).catch(() => null));
    }));
  }

  /** Whether the flag is set; `undefined` where nothing is loaded or the plane has no walkable tile. */
  private flag(x: number, y: number, plane: number, flag: number): boolean | undefined {
    const bytes = this.tiles.get(key(x >> 6, y >> 6, plane));
    if (!bytes) return undefined;
    const bit = ((y & 63) * SIZE + (x & 63)) * FLAGS + flag;
    return (bytes[bit >> 3] >> (bit & 7) & 1) === 1;
  }

  tile({ x, y, plane }: WorldPoint): TileCollision | undefined {
    if (!this.tiles.get(key(x >> 6, y >> 6, plane))) return undefined;
    const north = !!this.flag(x, y, plane, NORTH), east = !!this.flag(x, y, plane, EAST);
    const south = !!this.flag(x, y - 1, plane, NORTH), west = !!this.flag(x - 1, y, plane, EAST);
    return { north, east, south, west, blocked: !north && !east && !south && !west,
      wallNorth: !!this.flag(x, y, plane, WALL_NORTH), wallEast: !!this.flag(x, y, plane, WALL_EAST) };
  }
}

const key = (sx: number, sy: number, plane: number) => `${plane}/${sx}_${sy}`;

/** The collision layer of a tiles version; a missing file is a plane with no walkable tile. */
export function releaseTiles(base: string, version: string) {
  return async ({ x, y }: { x: number; y: number }, plane: number, signal?: AbortSignal): Promise<Uint8Array | null> => {
    const response = await fetch(`${base}/collision/${version}/${plane ? `p${plane}/` : ""}8/${x - ORIGIN_X}/${y - ORIGIN_Y}.bin`, { signal });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`collision ${x}_${y} plane ${plane}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

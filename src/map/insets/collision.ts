import type { WorldPoint } from "../../domain/contracts";

/**
 * The plugin's collision map as the tiles release publishes it (osrs-tiles `docs/tiles.md`): one file
 * per map square and plane at the zoom-8 tile address, 64 × 64 tiles × 4 flags, as the plugin's
 * `SplitFlagMap` reads them: whether the tile's north and east edges are open, and whether those
 * edges are walls or doors rather than objects.
 */

const SIZE = 64, FLAGS = 4, CONCURRENT = 12;
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
    this.listeners.forEach(listener => listener());
  }

  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();
  /** Squares asked for by `square`, fetched at most CONCURRENT at once; arrivals are told in batches. */
  private readonly queue: [string, { x: number; y: number }, number][] = [];
  private active = 0;
  private notify = 0;

  /** Called when a square asked for by `square` arrives. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * A map square's plane: its bytes, `null` where it has no walkable tile, or `undefined` until it
   * has arrived, which this asks for (once).
   */
  square(sx: number, sy: number, plane: number): Uint8Array | null | undefined {
    const name = key(sx, sy, plane);
    if (this.tiles.has(name)) return this.tiles.get(name);
    if (!this.pending.has(name)) {
      this.pending.add(name);
      this.queue.push([name, { x: sx, y: sy }, plane]);
      this.next();
    }
    return undefined;
  }

  private next() {
    while (this.active < CONCURRENT && this.queue.length) {
      // The latest asked for first: what is in view now.
      const [name, square, plane] = this.queue.pop()!;
      this.active++;
      void this.fetchTile(square, plane).catch(() => null).then(bytes => {
        this.tiles.set(name, bytes);
        this.pending.delete(name);
        this.active--;
        this.notify ||= requestAnimationFrame(() => { this.notify = 0; this.listeners.forEach(listener => listener()); });
        this.next();
      });
    }
  }

  /**
   * Which of a loaded square's tiles are blocked, 1 each, in rows from the south (`undefined` until it
   * has arrived, all blocked where it has no walkable tile); read straight from the bits, for drawing
   * many squares at once.
   */
  blockedTiles(sx: number, sy: number, plane: number): Uint8Array | undefined {
    const bytes = this.tiles.get(key(sx, sy, plane));
    if (bytes === undefined) return undefined;
    const blocked = new Uint8Array(4096);
    if (!bytes) return blocked.fill(1);
    const west = this.tiles.get(key(sx - 1, sy, plane)), south = this.tiles.get(key(sx, sy - 1, plane));
    const bit = (b: Uint8Array | null | undefined, x: number, y: number, flag: number) => {
      if (!b) return 0;
      const i = (y * SIZE + x) * FLAGS + flag;
      return b[i >> 3] >> (i & 7) & 1;
    };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const open = bit(bytes, x, y, NORTH) | bit(bytes, x, y, EAST)
        | (y ? bit(bytes, x, y - 1, NORTH) : bit(south, x, 63, NORTH)) | (x ? bit(bytes, x - 1, y, EAST) : bit(west, 63, y, EAST));
      blocked[y * 64 + x] = open ? 0 : 1;
    }
    return blocked;
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

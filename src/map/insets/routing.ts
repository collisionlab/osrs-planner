import type { WorldPoint } from "../../domain/contracts";

/**
 * The production routing graph as osrs-tiles publishes it (`docs/routing-layers.md` there): which
 * production component owns each search tile, whether walkable terrain is structurally reachable, and
 * the synthetic crossings between components. Pinned in `tiles.json.routingLayers`; every file is
 * checked against the manifest before use.
 */

export interface RoutingPin {
  version: string;
  tileVersion: string;
  pluginRevision: string;
  collisionContentSha256: string;
  transportSha256: string;
  separatorSha256: string;
}

export interface RoutingManifest {
  schemaVersion: 2;
  version: string;
  tileVersion: string;
  plugin: { repository: string; revision: string };
  collisionContentSha256: string;
  transportSha256: string;
  separatorSha256: string;
  componentCount: number;
  effectiveCrossingCount: number;
  searchTileCount: number;
  structurallyUnreachableTileCount: number;
  /** Unreachable natural components too large to be places (the seas), left out of the mask. */
  expanses: { minimumTiles: number; tileCount: number };
  files: Record<string, string>;
}

export interface RoutingComponent {
  id: number;
  plane: number;
  tileCount: number;
  /** x0, y0, x1, y1, the maxima exclusive. */
  bounds: [number, number, number, number];
  representative: [number, number, number];
  separatorCrossings: number;
  neighbours: number[];
}

export interface RoutingCrossing {
  /** Stable within the manifest's version; never a gameplay transport. */
  id: number;
  from: [number, number, number];
  to: [number, number, number];
  cost: number;
  fromComponent?: number;
  toComponent?: number;
}

/** Tile classifications in a square file. */
export const NON_WALKABLE = 0, REACHABLE = 1, UNREACHABLE = 2, EXPANSE = 3;

export interface RoutingSquare {
  /** Production component per tile, -1 where the tile isn't in the search graph. */
  owners: Int32Array;
  status: Uint8Array;
  /** Two bits per side, N/E/S/W from the low bits: 1 the search graph's exterior, 2 another component. */
  boundaries: Uint8Array;
  /** Tiles in the tile's natural walking component; 0 for non-walkable tiles. */
  naturalSizes: Uint32Array;
  crossings: number[];
  edges: RoutingCrossing[];
}

export interface RoutingOptions {
  components: boolean;
  separators: boolean;
  unreachable: boolean;
  /** Unreachable fragments smaller than this many tiles aren't drawn. */
  minimumSize: number;
  selectedComponent?: number;
  selectedCrossing?: RoutingCrossing;
}

export interface RoutingOverlay { data: RoutingData; options: RoutingOptions }

const MAGIC = 0x314c5452; // "RTL1"
const CONCURRENT_FETCHES = 16;
const CACHED_SQUARES = 256;

export const squarePath = ({ x, y, plane }: WorldPoint) => `p${plane}/${x >> 6}/${y >> 6}.bin`;
export const localTile = ({ x, y }: WorldPoint) => (y & 63) * 64 + (x & 63);

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: BufferSource) => hex(await crypto.subtle.digest("SHA-256", bytes));

/** An RTL1 square: little-endian, a palette of production ids, tile rows from south to north. */
export function decodeRouting(bytes: ArrayBuffer): RoutingSquare {
  const data = new DataView(bytes);
  if (bytes.byteLength < 16 || data.getUint32(0, true) !== MAGIC || data.getUint32(12, true) !== 4096) {
    throw new Error("Invalid routing square header");
  }
  const count = data.getUint32(4, true), crossingCount = data.getUint32(8, true);
  if (count > 4096 || bytes.byteLength !== 16 + count * 4 + 4096 * 8 + crossingCount * 4) throw new Error("Invalid routing square length");
  const palette = Array.from({ length: count }, (_, i) => data.getInt32(16 + i * 4, true));
  if (palette.some((id, i) => id < 0 || (i > 0 && id <= palette[i - 1]))) throw new Error("Invalid production component palette");

  const owners = new Int32Array(4096), status = new Uint8Array(4096), boundaries = new Uint8Array(4096), naturalSizes = new Uint32Array(4096);
  let offset = 16 + count * 4;
  for (let i = 0; i < 4096; i++, offset += 8) {
    const ref = data.getUint16(offset, true);
    status[i] = data.getUint8(offset + 2);
    boundaries[i] = data.getUint8(offset + 3);
    naturalSizes[i] = data.getUint32(offset + 4, true);
    const owned = ref > 0;
    if (ref > count || status[i] > EXPANSE || (owned && status[i] !== REACHABLE) || (status[i] === NON_WALKABLE) !== (naturalSizes[i] === 0)) {
      throw new Error("Invalid routing tile classification");
    }
    for (let side = 0; side < 4; side++) if (((boundaries[i] >> (side * 2)) & 3) === 3) throw new Error("Invalid boundary kind");
    owners[i] = owned ? palette[ref - 1] : -1;
  }
  const crossings = Array.from({ length: crossingCount }, (_, i) => data.getUint32(offset + i * 4, true));
  return { owners, status, boundaries, naturalSizes, crossings, edges: [] };
}

const FILE_PATH = /^(components\.json|crossings\.json|p[0-3]\/\d+\/\d+\.(bin|crossings\.json))$/;

/** The manifest must be the one the pin names, for the pinned tiles, plugin and inputs. */
export function validateRoutingManifest(manifest: RoutingManifest, pin: RoutingPin, tileVersion: string) {
  const matches = manifest.schemaVersion === 2 && manifest.version === pin.version
    && pin.tileVersion === tileVersion && manifest.tileVersion === tileVersion
    && manifest.plugin?.repository === "Skretzo/shortest-path" && manifest.plugin.revision === pin.pluginRevision
    && manifest.collisionContentSha256 === pin.collisionContentSha256
    && manifest.transportSha256 === pin.transportSha256
    && manifest.separatorSha256 === pin.separatorSha256;
  if (!matches) throw new Error("Routing layers do not match the pinned collision, transports, separators or plugin revision");
  if (!manifest.files?.["components.json"]) throw new Error("Incomplete routing manifest");
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!FILE_PATH.test(path) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid routing file index");
  }
}

function crossingsMatch(square: RoutingSquare) {
  return square.edges.length === square.crossings.length && square.edges.every((edge, i) => edge.id === square.crossings[i]
    && edge.from.length === 3 && edge.to.length === 3 && edge.from[2] === edge.to[2] && edge.cost >= 0
    && Math.max(Math.abs(edge.from[0] - edge.to[0]), Math.abs(edge.from[1] - edge.to[1])) === 1);
}

/**
 * The squares of one verified release, fetched on demand and shared by every placement of an inset:
 * at most CONCURRENT_FETCHES at once, the CACHED_SQUARES most recently used kept. A failed fetch stays an
 * error; it never reads as missing collision or unreachable terrain.
 */
export class RoutingData {
  private readonly squares = new Map<string, RoutingSquare>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly waiting: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private active = 0;
  private components?: Promise<Map<number, RoutingComponent>>;
  error?: string;

  constructor(readonly base: string, readonly manifest: RoutingManifest) {}

  static async load(base: string, pin: RoutingPin, tileVersion: string, signal?: AbortSignal) {
    const response = await fetch(`${base}/manifest.json`, { signal });
    if (!response.ok) throw new Error(`Routing manifest: ${response.status}`);
    const manifest = await response.json() as RoutingManifest;
    validateRoutingManifest(manifest, pin, tileVersion);
    // The version is the content address of the rest of the manifest.
    const { version, ...content } = manifest;
    if ((await sha256(new TextEncoder().encode(JSON.stringify(content)))).slice(0, 24) !== version) {
      throw new Error("Routing manifest content address mismatch");
    }
    return new RoutingData(base, manifest);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** For tests: a square as if it had been fetched. */
  put(path: string, square: RoutingSquare) { this.squares.set(path, square); }

  /** A loaded square, now the most recently used. */
  get(path: string) {
    const square = this.squares.get(path);
    if (square) {
      this.squares.delete(path);
      this.squares.set(path, square);
    }
    return square;
  }

  loadSquare(path: string): Promise<void> {
    if (this.squares.has(path) || this.failed.has(path) || !this.manifest.files[path]) return Promise.resolve();
    const existing = this.pending.get(path);
    if (existing) return existing;
    const task = (async () => {
      if (this.active >= CONCURRENT_FETCHES) await new Promise<void>(resolve => this.waiting.push(resolve));
      else this.active++;
      const square = decodeRouting(await this.file(path));
      if (square.crossings.length) {
        square.edges = JSON.parse(new TextDecoder().decode(await this.file(path.replace(".bin", ".crossings.json")))) as RoutingCrossing[];
        if (!crossingsMatch(square)) throw new Error("Invalid separator records");
      }
      this.squares.set(path, square);
      while (this.squares.size > CACHED_SQUARES) this.squares.delete(this.squares.keys().next().value!);
    })().catch(error => {
      this.failed.add(path);
      this.error = String(error);
    }).finally(() => {
      this.pending.delete(path);
      // Hand the slot straight to a waiting fetch, or free it.
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
      this.listeners.forEach(listener => listener());
    });
    this.pending.set(path, task);
    return task;
  }

  async component(id: number) {
    this.components ??= this.file("components.json")
      .then(bytes => new Map((JSON.parse(new TextDecoder().decode(bytes)) as RoutingComponent[]).map(component => [component.id, component])));
    return (await this.components).get(id);
  }

  /** What the release says about a tile, each case said separately. */
  inspect(point: WorldPoint): { status: string; component?: number } {
    const path = squarePath(point), square = this.get(path), i = localTile(point);
    if (!this.manifest.files[path]) return { status: "Missing collision data" };
    if (!square) return { status: this.error || "Loading routing tile…" };
    const component = square.owners[i] >= 0 ? square.owners[i] : undefined;
    switch (square.status[i]) {
      case NON_WALKABLE: return { status: "Non-walkable terrain" };
      case UNREACHABLE: return { status: "Structurally unreachable walking terrain · outside the retained production search graph" };
      case EXPANSE: return { status: `Open expanse (${square.naturalSizes[i].toLocaleString()} tiles, a sea): walkable in collision, not counted as unreachable` };
      default: return component === undefined
        ? { status: "Reachable walking terrain · outside the retained production search graph" }
        : { status: "Retained production search tile", component };
    }
  }

  private async file(path: string) {
    const response = await fetch(`${this.base}/${path}`);
    if (!response.ok) throw new Error(`Routing ${path}: ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (await sha256(bytes) !== this.manifest.files[path]) throw new Error(`Routing checksum mismatch: ${path}`);
    return bytes;
  }
}

/** Whether a tile is drawn in the unreachable mask: unreachable, and in a fragment at least `minimumSize` tiles. */
export function visibleNegative(square: RoutingSquare, index: number, minimumSize: number) {
  return square.status[index] === UNREACHABLE && square.naturalSizes[index] >= minimumSize;
}

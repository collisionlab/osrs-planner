import type { WorldPoint } from "../../domain/contracts";


export interface RoutingPin {
  version: string; tileVersion: string; pluginRevision: string;
  collisionContentSha256: string; transportSha256: string; separatorSha256: string;
}
export interface RoutingManifest {
  schemaVersion: 1; version: string; tileVersion: string;
  plugin: { repository: string; revision: string };
  collisionContentSha256: string; transportSha256: string; separatorSha256: string;
  componentCount: number; effectiveCrossingCount: number; searchTileCount: number; structurallyUnreachableTileCount: number;
  files: Record<string, string>;
}
export interface RoutingComponent {
  id: number; plane: number; tileCount: number; bounds: [number, number, number, number]; representative: [number, number, number];
  separatorCrossings: number; neighbours: number[];
}
export interface RoutingCrossing {
  /** Stable within manifest.version; never interpreted as a gameplay transport. */
  id: number; from: [number, number, number]; to: [number, number, number]; cost: number;
  fromComponent?: number; toComponent?: number;
}
export interface RoutingSquare {
  owners: Int32Array; status: Uint8Array; boundaries: Uint8Array; naturalSizes: Uint32Array;
  crossings: number[]; edges: RoutingCrossing[];
}
export interface RoutingOptions {
  components: boolean; separators: boolean; unreachable: boolean; minimumSize: number;
  selectedComponent?: number; selectedCrossing?: RoutingCrossing;
}
export interface RoutingOverlay { data: RoutingData; options: RoutingOptions }
export const squarePath = ({ x, y, plane }: WorldPoint) => `p${plane}/${x >> 6}/${y >> 6}.bin`;
export const localTile = ({ x, y }: WorldPoint) => (y & 63) * 64 + (x & 63);

/** RTL1: LE, palette of production IDs, y-major rows from south to north. */
export function decodeRouting(bytes: ArrayBuffer): RoutingSquare {
  const data = new DataView(bytes);
  if (bytes.byteLength < 16 || data.getUint32(0, true) !== 0x314c5452 || data.getUint32(12, true) !== 4096) throw new Error("Invalid routing square header");
  const count = data.getUint32(4, true), crossingCount = data.getUint32(8, true);
  if (count > 4096 || bytes.byteLength !== 16 + count * 4 + 4096 * 8 + crossingCount * 4) throw new Error("Invalid routing square length");
  const palette = Array.from({ length: count }, (_, i) => data.getInt32(16 + i * 4, true));
  if (palette.some((id, i) => id < 0 || (i > 0 && id <= palette[i - 1]))) throw new Error("Invalid production component palette");
  const owners = new Int32Array(4096), status = new Uint8Array(4096), boundaries = new Uint8Array(4096), naturalSizes = new Uint32Array(4096);
  let offset = 16 + count * 4;
  for (let i = 0; i < 4096; i++, offset += 8) {
    const ref = data.getUint16(offset, true);
    status[i] = data.getUint8(offset + 2); boundaries[i] = data.getUint8(offset + 3); naturalSizes[i] = data.getUint32(offset + 4, true);
    if (ref > count || status[i] > 2 || (ref > 0 && status[i] !== 1) || (status[i] === 0) !== (naturalSizes[i] === 0)) throw new Error("Invalid routing tile classification");
    for (let side = 0; side < 4; side++) if (((boundaries[i] >> (side * 2)) & 3) === 3) throw new Error("Invalid boundary kind");
    owners[i] = ref ? palette[ref - 1] : -1;
  }
  return { owners, status, boundaries, naturalSizes, crossings: Array.from({ length: crossingCount }, (_, i) => data.getUint32(offset + i * 4, true)), edges: [] };
}
export function validateRoutingManifest(manifest: RoutingManifest, pin: RoutingPin, tileVersion: string) {
  if (manifest.schemaVersion !== 1 || manifest.version !== pin.version || pin.tileVersion !== tileVersion || manifest.tileVersion !== tileVersion
    || manifest.plugin?.repository !== "Skretzo/shortest-path" || manifest.plugin.revision !== pin.pluginRevision
    || manifest.collisionContentSha256 !== pin.collisionContentSha256 || manifest.transportSha256 !== pin.transportSha256
    || manifest.separatorSha256 !== pin.separatorSha256) throw new Error("Routing layers do not match the pinned collision, transports, separators or plugin revision");
  if (!manifest.files || !manifest.files["components.json"]) throw new Error("Incomplete routing manifest");
  for (const [path, hash] of Object.entries(manifest.files)) if (!/^(components\.json|crossings\.json|p[0-3]\/\d+\/\d+\.(bin|crossings\.json))$/.test(path) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid routing file index");
}

/** Shared, bounded source-square cache: placements never change the fetch key. Errors stay errors. */
export class RoutingData {
  readonly squares = new Map<string, RoutingSquare>();
  private readonly pending = new Map<string, Promise<void>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private components?: Promise<Map<number, RoutingComponent>>;
  error?: string;
  constructor(readonly base: string, readonly manifest: RoutingManifest) {}
  static async load(base: string, pin: RoutingPin, tileVersion: string, signal?: AbortSignal) {
    const response = await fetch(`${base}/manifest.json`, { signal });
    if (!response.ok) throw new Error(`Routing manifest: ${response.status}`);
    const manifest = await response.json() as RoutingManifest;
    validateRoutingManifest(manifest, pin, tileVersion);
    const { version, ...content } = manifest;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(content)));
    const address = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("").slice(0,24);
    if (address !== version) throw new Error("Routing manifest content address mismatch");
    return new RoutingData(base, manifest);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private async file(path: string) {
    const response = await fetch(`${this.base}/${path}`);
    if (!response.ok) throw new Error(`Routing ${path}: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== this.manifest.files[path]) throw new Error(`Routing checksum mismatch: ${path}`);
    return bytes;
  }
  get(path: string) {
    const value = this.squares.get(path);
    if (value) { this.squares.delete(path); this.squares.set(path, value); }
    return value;
  }
  loadSquare(path: string): Promise<void> {
    if (this.squares.has(path) || this.failed.has(path) || !this.manifest.files[path]) return Promise.resolve();
    const existing = this.pending.get(path); if (existing) return existing;
    const task = (async () => {
      if (this.active >= 16) await new Promise<void>(resolve => this.waiting.push(resolve));
      else this.active++;
      const square = decodeRouting(await this.file(path));
      if (square.crossings.length) {
        square.edges = JSON.parse(new TextDecoder().decode(await this.file(path.replace(".bin", ".crossings.json")))) as RoutingCrossing[];
        if (square.edges.length !== square.crossings.length || square.edges.some((edge, i) => edge.id !== square.crossings[i]
          || edge.from.length !== 3 || edge.to.length !== 3 || edge.from[2] !== edge.to[2] || edge.cost < 0
          || Math.max(Math.abs(edge.from[0] - edge.to[0]), Math.abs(edge.from[1] - edge.to[1])) !== 1)) throw new Error("Invalid separator records");
      }
      this.squares.set(path, square);
      while (this.squares.size > 256) this.squares.delete(this.squares.keys().next().value!);
    })().catch(error => { this.failed.add(path); this.error = String(error); }).finally(() => {
      this.pending.delete(path);
      const next = this.waiting.shift(); if (next) next(); else this.active--;
      this.listeners.forEach(listener => listener());
    });
    this.pending.set(path, task); return task;
  }
  async component(id: number) {
    this.components ??= this.file("components.json").then(bytes => new Map((JSON.parse(new TextDecoder().decode(bytes)) as RoutingComponent[]).map(c => [c.id, c])));
    return (await this.components).get(id);
  }
  inspect(point: WorldPoint) {
    const path = squarePath(point), square = this.get(path), i = localTile(point);
    if (!this.manifest.files[path]) return { status: "Missing collision data", component: undefined };
    if (!square) return { status: this.error || "Loading routing tile…", component: undefined };
    const component = square.owners[i] >= 0 ? square.owners[i] : undefined;
    const status = square.status[i] === 2 ? "Structurally unreachable walking terrain · outside the retained production search graph"
      : square.status[i] === 0 ? "Non-walkable terrain" : component === undefined ? "Reachable walking terrain · outside the retained production search graph" : "Retained production search tile";
    return { status, component };
  }
}

export function visibleNegative(square: RoutingSquare, index: number, minimumSize: number) {
  return square.status[index] === 2 && square.naturalSizes[index] >= minimumSize;
}

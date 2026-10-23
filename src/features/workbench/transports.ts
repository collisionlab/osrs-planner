import type { WorldPoint } from "../../domain/contracts";
import type { CollisionMap } from "../../map/insets/collision";
import type { FeatureOverlay, FeatureTone, MapFeature } from "../../map/insets/features";
import type { WorldBox } from "../../map/insets/projection";

/**
 * The transport explorer's data, from the planner service (`shortestpath.workbench.TransportCatalog`):
 * the plugin's effective transports as its own loader builds them, each traced to the TSV rows it
 * came from, asked for a view at a time.
 */

export interface Revision { repository: string; rev: string }
export interface TypeCount { type: string; count: number; teleport: boolean }
export interface TransportMeta {
  plugin: Revision;
  tooling: Revision;
  total: number;
  viewLimit: number;
  types: TypeCount[];
}

export interface TransportSummary {
  id: string;
  type: string;
  file: string;
  /** Null for a teleport: it leaves from anywhere. */
  origin: WorldPoint | null;
  destination: WorldPoint;
  label: string;
  teleport: boolean;
  /** `row`: one TSV row; `paired`: an origin row with a destination row (a network); `teleport`. */
  construction: "row" | "paired" | "teleport";
  /** Where the row said it went, before the plugin moved it to the house's landing tile. */
  remappedFrom: WorldPoint | null;
}

export interface TransportSource {
  /** `row`, or the `origin`/`destination` half of a pairing. */
  role: "row" | "origin" | "destination";
  file: string;
  line: number;
  section: string;
  /** The row's columns as written. */
  fields: Record<string, string>;
}

export interface TransportDetail extends TransportSummary {
  objectInfo: string | null;
  displayInfo: string | null;
  duration: number;
  consumable: boolean;
  maxWildernessLevel: number;
  requirements: { kind: string; name: string }[];
  varChecks: string[];
  sources: TransportSource[];
}

export interface Cluster { plane: number; x1: number; y1: number; x2: number; y2: number; count: number }
export interface TransportView { total: number; transports: TransportSummary[]; clusters: Cluster[] }

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/workbench/v1/transports${path}`, { signal });
  if (!response.ok) {
    const message = await response.json().then(body => body?.error, () => undefined);
    throw new Error(message || `The transport service answered ${response.status}.`);
  }
  return response.json();
}

const typesQuery = (types?: string[]) => types ? `types=${encodeURIComponent(types.join(","))}` : "";
export const boxesQuery = (boxes: WorldBox[]) => boxes.map(box => [box.plane, box.x1, box.y1, box.x2, box.y2].join(",")).join(";");

export const loadMeta = (signal?: AbortSignal) => get<TransportMeta>("/meta", signal);
export const loadDetail = (id: string, signal?: AbortSignal) => get<TransportDetail>(`/${encodeURIComponent(id)}`, signal);
export const loadView = (boxes: WorldBox[], types: string[] | undefined, signal?: AbortSignal) =>
  get<TransportView>(`?view=${encodeURIComponent(boxesQuery(boxes))}${types ? `&${typesQuery(types)}` : ""}`, signal);
export const searchTransports = (query: string, types: string[] | undefined, signal?: AbortSignal) =>
  get<TransportSummary[]>(`/search?q=${encodeURIComponent(query)}${types ? `&${typesQuery(types)}` : ""}`, signal);

/** Objects used where they stand; journeys between stations; teleports, from anywhere or from a fixed spot. */
const OBJECT_TYPES = new Set(["TRANSPORT", "AGILITY_SHORTCUT", "GRAPPLE_SHORTCUT"]);
const TELEPORT_TYPES = new Set(["TELEPORTATION_LEVER", "TELEPORTATION_PORTAL", "TELEPORTATION_PORTAL_POH", "TELEPORTATION_BOX",
  "TELEPORTATION_MINIGAME", "TELEPORTATION_SPELL", "TELEPORTATION_SPELL_HOME", "TELEPORTATION_ITEM", "WILDERNESS_OBELISK", "QUETZAL_WHISTLE"]);
export function toneOf(summary: { type: string; teleport: boolean }): FeatureTone {
  if (summary.teleport || TELEPORT_TYPES.has(summary.type)) return "teleport";
  return OBJECT_TYPES.has(summary.type) ? "object" : "journey";
}
export const toneOfType = (type: TypeCount) => toneOf({ type: type.type, teleport: type.teleport });

/** `AGILITY_SHORTCUT` → `Agility shortcut`. */
export const typeName = (type: string) => type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");

const inBox = (point: WorldPoint, box: WorldBox) => point.plane === box.plane && point.x >= box.x1 && point.x <= box.x2 && point.y >= box.y1 && point.y <= box.y2;

/**
 * A transport's features: its tiles, and the edge between them, or a teleport's landing alone (no
 * origin is made up). Given the boxes in view, an edge leaving the view isn't drawn (a fairy ring
 * would otherwise cross the map to every other ring), nor an end outside it.
 */
export function transportFeatures(summary: TransportSummary, inView?: WorldBox[]): MapFeature[] {
  const tone = toneOf(summary), key = summary.id;
  const shown = (point: WorldPoint) => !inView || inView.some(box => inBox(point, box));
  const features: MapFeature[] = [];
  if (summary.origin && shown(summary.origin) && shown(summary.destination)) features.push({ kind: "edge", key, from: summary.origin, to: summary.destination, tone });
  if (summary.origin && shown(summary.origin)) features.push({ kind: "point", key, point: summary.origin, tone, role: "origin" });
  if (shown(summary.destination)) features.push({ kind: "point", key, point: summary.destination, tone, role: "destination" });
  return features;
}

export const clusterKey = (index: number) => `cluster:${index}`;

/**
 * The overlay for a view: each listed transport (what of it is in view), or each counted area when
 * there were too many, plus the whole selected transport (whether or not it is in view), which the
 * map lays out and draws collision around.
 */
export function viewOverlay(view: TransportView | undefined, selected: TransportSummary | undefined, collision?: CollisionMap,
  inView?: WorldBox[]): FeatureOverlay {
  const features: MapFeature[] = [];
  view?.clusters.forEach((cluster, index) => features.push({ kind: "region", key: clusterKey(index), plane: cluster.plane,
    bounds: [cluster.x1, cluster.y1, cluster.x2, cluster.y2], tone: "count", label: String(cluster.count) }));
  for (const summary of view?.transports || []) if (summary.id !== selected?.id) features.push(...transportFeatures(summary, inView));
  const anchors = selected ? transportFeatures(selected) : [];
  // The selection is drawn last, over the rest.
  return { features: [...features, ...anchors], anchors, selected: selected?.id, collision };
}

/** What the page's URL holds: the selected transport, where the map is, the types shown and a search. */
export interface ExplorerState {
  selected?: string;
  at?: { point: WorldPoint; zoom: number };
  /** Undefined for every type. */
  types?: string[];
  query?: string;
}

const POINT = /^(\d{1,5}),(\d{1,5}),([0-3])$/;
export function readState(search: string): ExplorerState {
  const params = new URLSearchParams(search);
  const state: ExplorerState = {};
  const selected = params.get("t");
  if (selected && /^[0-9a-f]{12}(-\d{1,4})?$/.test(selected)) state.selected = selected;
  const at = POINT.exec(params.get("at") || ""), zoom = Number(params.get("z"));
  if (at) state.at = { point: { x: Number(at[1]), y: Number(at[2]), plane: Number(at[3]) }, zoom: zoom >= 4 && zoom <= 11 ? zoom : 8 };
  const types = params.get("types");
  if (types !== null) state.types = types.split(",").filter(type => /^[A-Z_]+$/.test(type));
  const query = params.get("q");
  if (query) state.query = query;
  return state;
}

export function writeState(state: ExplorerState): string {
  const params = new URLSearchParams();
  if (state.selected) params.set("t", state.selected);
  if (state.at) { params.set("at", `${state.at.point.x},${state.at.point.y},${state.at.point.plane}`); params.set("z", String(state.at.zoom)); }
  if (state.types) params.set("types", state.types.join(","));
  if (state.query) params.set("q", state.query);
  const text = params.toString().replace(/%2C/g, ",");
  return text ? `?${text}` : "";
}

/** A typed tile (`3222 3218 0`, `3222,3218,0`, or without a plane), or nothing. */
export function parseTile(text: string): WorldPoint | undefined {
  const match = /^\s*(\d{1,5})[\s,]+(\d{1,5})(?:[\s,]+([0-3]))?\s*$/.exec(text);
  return match ? { x: Number(match[1]), y: Number(match[2]), plane: Number(match[3] ?? 0) } : undefined;
}

/** The source row on GitHub, at the plugin commit the data came from (or its default branch if unknown). */
export function sourceUrl(plugin: Revision, source: TransportSource) {
  const rev = /^[0-9a-f]{40}$/.test(plugin.rev) ? plugin.rev : "master";
  return `https://github.com/${plugin.repository}/blob/${rev}/${source.file}#L${source.line}`;
}

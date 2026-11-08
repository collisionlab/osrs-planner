import type { Revision } from "./transports";
import type { FeatureOverlay, MapFeature } from "../../map/insets/features";
import type { WorldPoint } from "../../domain/contracts";
import { pointText } from "./invariants";

/**
 * A cache placement a player moves through, as tooling's snapshot records it, or a world map link
 * (object id -1, its icon's tile).
 */
export interface Connector {
  objectId: number; ids: number[]; name: string; options: string[];
  x: number; y: number; plane: number; sizeX: number; sizeY: number;
  partner: null | { objectId: number; name: string; option: string; x: number; y: number; plane: number; sizeX: number; sizeY: number;
    /** `vertical` (one plane up or down), `id+offset` (a neighbouring id about 6,400 tiles away) or `map-link`. */
    rule: string };
}

/** The game's agility shortcut map icon, with RuneLite's description of the shortcut when it knows it. */
export interface ShortcutIcon {
  x: number; y: number; plane: number;
  runelite: string | null; description: string | null; level: number;
  obstacles: Connector[];
}

/**
 * One connector of an item: inside the area (`way-out`) or on reached ground leading in (`way-in`), a
 * shortcut's obstacle, or a connector beside a dungeon entrance icon.
 */
export interface CandidateConnector {
  role: "way-in" | "way-out" | "open-end" | "shortcut" | "entrance";
  connector: Connector;
  /** Walkable tiles beside the connector and beside its partner. */
  stand: WorldPoint; partnerStand: WorldPoint | null;
}

/** An unreached walking area and the uncovered cache connectors that would join it to reached ground. */
export interface CandidateItem {
  id: string; kind: CandidateKind; title: string;
  /** Area only: the world map's name for a place in it, which also titles it. */
  label: string | null;
  areaTiles: number | null;
  /** minX, minY, maxX, maxY, plane. */
  bounds: [number, number, number, number, number] | null;
  focus: WorldPoint;
  contains: Record<string, number> | null;
  paired: boolean;
  connectors: CandidateConnector[];
  shortcut: ShortcutIcon | null;
  review: { status: "unreviewed" | "accepted" | "rejected" | "needs_evidence" | "deferred"; explanation?: string; reference?: string };
}

export interface CandidateReport {
  rule: string;
  /** The cache the snapshot was read from and the plugin whose rows it was made against. */
  cache: string; snapshotPlugin: string;
  extraction: Record<string, number>;
  /** Counts at each step of the live judgement, in order. */
  funnel: Record<string, number>;
  /** The map icon that marks agility shortcuts, and how many of its placements have a shortcut row within 5 tiles. */
  shortcutMarker: { field: string | null; icons: number; iconsNearRows: number } | null;
  /** The map icon that marks dungeon entrances, and how many of its placements have a row going down or in within 5 tiles. */
  dungeonMarker: { field: string | null; icons: number; iconsNearRows: number } | null;
  items: CandidateItem[];
  plugin: Revision; tooling: Revision;
}

export const candidateKinds = ["area", "shortcut", "dungeon"] as const;
export type CandidateKind = typeof candidateKinds[number];
export const kindNames: Record<CandidateKind, string> = {
  area: "Unreached areas", shortcut: "Agility shortcuts", dungeon: "Dungeon entrances",
};

export const roleNames: Record<CandidateConnector["role"], string> = {
  "way-in": "Way in", "way-out": "Way out", "open-end": "Unknown far end", shortcut: "Obstacle", entrance: "Beside the icon",
};

/** A world map link has no object: it is its icon. */
const objectText = (c: { name: string; objectId: number }, option: string) => c.objectId < 0 ? c.name : `${option} ${c.name} ${c.objectId}`;
export const connectorText = (c: Connector) => objectText(c, c.options[0] ?? "");
export const partnerText = (c: Connector) => c.partner ? objectText(c.partner, c.partner.option) : "—";

/** What the area holds, e.g. "1 altar · 3 transport origins". */
export function containsText(item: CandidateItem) {
  const entries = Object.entries(item.contains ?? {});
  return entries.length ? entries.map(([kind, n]) => `${n} ${kind}`).join(" · ") : "";
}

export function itemMeta(item: CandidateItem) {
  if (item.kind === "dungeon") {
    return item.connectors.length ? [...new Set(item.connectors.map(c => connectorText(c.connector)))].join(", ") : "no connector beside the icon";
  }
  if (item.shortcut) {
    const level = item.shortcut.level > 0 ? `${item.shortcut.level} Agility` : "level unknown";
    const obstacles = item.connectors.length ? [...new Set(item.connectors.map(c => connectorText(c.connector)))].join(", ") : "no obstacle found";
    return `${level} · ${obstacles}`;
  }
  const parts = item.areaTiles === null ? [] : [`${item.areaTiles.toLocaleString()} tiles`];
  const holds = containsText(item);
  if (holds) parts.push(holds);
  parts.push(`${item.connectors.length} connector${item.connectors.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function filterItems(items: CandidateItem[], query: string, kind = "") {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => (!kind || item.kind === kind) && words.every(word => [item.id, item.title, containsText(item), pointText(item.focus),
    ...item.connectors.flatMap(c => [connectorText(c.connector), partnerText(c.connector), pointText(c.stand)])]
    .join(" ").toLowerCase().includes(word)));
}

/**
 * The item as the map draws it: the area's bounds or the shortcut's icon, and each connector as an
 * edge from where it is used to where its partner stands. The edges are anchors, so an area off the main map is laid out
 * beside the way in.
 */
export function itemOverlay(item: CandidateItem): FeatureOverlay {
  const features: MapFeature[] = [];
  if (item.bounds) {
    const [x1, y1, x2, y2, plane] = item.bounds;
    features.push({ kind: "region", key: item.id, plane, bounds: [x1, y1, x2, y2], tone: "suspect", dashed: true,
      label: `Unreached · ${item.areaTiles?.toLocaleString()} tiles` });
  }
  if (item.shortcut || item.kind === "dungeon") {
    const { x, y, plane } = item.shortcut ?? item.focus;
    features.push({ kind: "point", key: item.id, point: { x, y, plane }, tone: "suspect", role: "destination",
      title: `${item.shortcut ? "Agility shortcut" : "Dungeon entrance"} icon · ${pointText({ x, y, plane })}` });
  }
  for (const c of item.connectors) {
    const title = `${roleNames[c.role]}: ${connectorText(c.connector)}`;
    features.push({ kind: "point", key: item.id, point: c.stand, tone: "candidate", role: "origin", title: `${title} · ${pointText(c.stand)}` });
    if (!c.partnerStand) continue;
    features.push({ kind: "edge", key: item.id, from: c.stand, to: c.partnerStand, tone: "candidate", title });
    features.push({ kind: "point", key: item.id, point: c.partnerStand, tone: "candidate", role: "destination",
      title: `${partnerText(c.connector)} · ${pointText(c.partnerStand)}` });
  }
  return { features, anchors: features, selected: item.id };
}

export function reviewNote(item: CandidateItem, report: CandidateReport) {
  const lines = item.connectors.map(c => `  - ${roleNames[c.role]}: ${connectorText(c.connector)} at ${pointText(c.stand)}`
    + (c.connector.partner ? ` → ${partnerText(c.connector)} at ${pointText(c.partnerStand)} (${c.connector.partner.rule})` : ""));
  const shortcut = item.shortcut ? `\n- Shortcut icon at ${pointText(item.shortcut)}${item.shortcut.runelite
    ? `; RuneLite ${item.shortcut.runelite}, ${item.shortcut.level} Agility` : ""}` : "";
  return `### Transport candidate ${item.id}

- ${item.title}${item.areaTiles === null ? "" : `, ${item.areaTiles} tiles`}${containsText(item) ? `, ${containsText(item)}` : ""}${shortcut}
- Connectors (cache ${report.cache}):
${lines.join("\n")}
- Plugin: ${report.plugin.repository}@${report.plugin.rev}
- Decision: needs_evidence
- Explanation / verification evidence:
`;
}

export async function loadCandidates(signal: AbortSignal): Promise<CandidateReport> {
  const response = await fetch("/api/workbench/v1/candidates", { signal });
  if (!response.ok) throw new Error(`Candidate service answered ${response.status}`);
  return response.json();
}

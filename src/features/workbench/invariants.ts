import type { TransportRow } from "./api";
import type { Revision } from "./transports";
import { geometryOverlay } from "./review";
import type { FeatureOverlay } from "../../map/insets/features";
import type { WorldPoint } from "../../domain/contracts";

export const invariants = ["destination", "entry", "location", "clue", "forestry", "star"] as const;
export type Invariant = typeof invariants[number];
export const invariantNames: Record<Invariant, string> = {
  destination: "Destination", entry: "Entry", location: "Location", clue: "Clue step", forestry: "Forestry call", star: "Shooting star",
};

/**
 * One data line that breaks an invariant, as the service found it in its bundled plugin data, or in
 * one of tooling's site lists (clue steps, Forestry calls, shooting stars).
 */
export interface Finding {
  id: string; invariant: Invariant;
  /** Repository path, e.g. `src/main/resources/transports/transports.tsv` (in tooling for a site), and 1-based line. */
  file: string; line: number; raw: string;
  row: TransportRow;
  /** The tile that breaks the rule: a landing, a start or a location. */
  focus: WorldPoint;
  failure: string;
  location?: { kind: string; name: string; areaTiles: number | null };
  /** A site from one of tooling's lists: its id and name there, category, and where its tile came from. */
  site?: { id: string; name: string; category: string; source: string; areaTiles: number | null };
  review: { status: "unreviewed" | "accepted" | "rejected" | "needs_evidence" | "deferred"; explanation?: string; reference?: string };
}
export interface InvariantReport { rules: Record<Invariant, string>; findings: Finding[]; plugin: Revision; tooling: Revision }

export const pointText = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "—";
export const fileName = (f: Finding) => f.file.slice(f.file.lastIndexOf("/") + 1);

export function findingLabel(f: Finding) {
  if (f.site) return `${invariantNames[f.invariant]} · ${f.site.name || f.site.id}`;
  if (f.location) return `${f.location.kind[0].toUpperCase()}${f.location.kind.slice(1)} · ${f.location.name || pointText(f.focus)}`;
  return f.row.label || f.row.fields["Display info"] || `${fileName(f)}:${f.line}`;
}

export function filterFindings(findings: Finding[], invariant: string, query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return findings.filter(f => (!invariant || f.invariant === invariant)
    && words.every(word => [f.file, findingLabel(f), f.raw, f.failure, pointText(f.focus), f.row.section].join(" ").toLowerCase().includes(word)));
}

/** The finding's row as the map draws it, with the tile that breaks the rule marked. */
export function findingOverlay(f: Finding): FeatureOverlay {
  if (f.invariant === "location" || f.site) {
    const features = [{ kind: "point" as const, key: f.id, point: f.focus, role: "destination" as const, tone: "suspect" as const, title: `${findingLabel(f)} · ${pointText(f.focus)}` }];
    return { features, anchors: features, selected: f.id };
  }
  const overlay = geometryOverlay([{ key: f.id, original: f.row, suggested: null }], f.id);
  const role = f.invariant === "destination" ? "destination" : "origin";
  for (const feature of overlay.features) if (feature.kind === "point" && feature.role === role) {
    feature.tone = "suspect";
    feature.title = `${f.failure} · ${pointText(feature.point)}`;
  }
  return overlay;
}

/** The line at the checked revision: the plugin's, or tooling's for a site. */
export function sourceUrl(f: Finding, revisions: { plugin: Revision; tooling: Revision }) {
  const { repository, rev } = f.site ? revisions.tooling : revisions.plugin;
  return `https://github.com/${repository}/blob/${rev}/${f.file}#L${f.line}`;
}

export function reviewNote(f: Finding, revisions: { plugin: Revision; tooling: Revision }) {
  return `### ${invariantNames[f.invariant]} invariant ${f.id}

- Row: ${sourceUrl(f, revisions)}
- Tile: ${pointText(f.focus)}
- Failure: ${f.failure}
- Current line: ${f.raw}
- Decision: needs_evidence
- Explanation / verification evidence:
`;
}

export async function loadInvariants(signal: AbortSignal): Promise<InvariantReport> {
  const response = await fetch("/api/workbench/v1/invariants", { signal });
  if (!response.ok) throw new Error(`Invariant service answered ${response.status}`);
  return response.json();
}

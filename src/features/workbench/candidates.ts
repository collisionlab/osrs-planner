import type { TransportRow } from "./api";
import type { Revision } from "./transports";
import { geometryOverlay } from "./review";
import type { CollisionMap } from "../../map/insets/collision";
import type { WorldPoint } from "../../domain/contracts";

export const categories = ["plane", "non_floor", "coordinate_offset", "missing_requirements", "unrepresentable_requirements",
  "sourced_transport", "sourced_transport_outside_routing", "sourced_teleport", "network_stop", "cache_transport", "unsourced_transport", "copied_area", "copied_area_teleport", "destination_violation"] as const;
export const categoryDescriptions: Record<typeof categories[number], string> = {
  plane: "The proposed correction changes an endpoint's plane.",
  non_floor: "The contributor reports an endpoint on a tile without floor in their cache data.",
  coordinate_offset: "The proposed correction moves an endpoint's coordinates.",
  missing_requirements: "The proposal adds requirements missing from an existing transport.",
  unrepresentable_requirements: "Reported requirements cannot be expressed in the current TSV format; no replacement row is supplied.",
  sourced_transport: "New transport with Wiki/cache citations. Both endpoints belong to existing routing components (including attached transport sites); they need not be in the same component.",
  sourced_transport_outside_routing: "New transport with Wiki/cache citations where at least one endpoint is outside existing routing components. Both ends may be outside; investigate tiles and routing coverage.",
  sourced_teleport: "New teleport with source citations; it has a destination and no fixed origin.",
  network_stop: "Proposed boarding/landing stop for a transport network, not a complete route between stops.",
  cache_transport: "New ladder, stairs or crossing inferred from cache data; not verified in-game.",
  unsourced_transport: "New transport whose endpoint tiles lack supporting sources.",
  copied_area: "New transport in a copy of another area; instance and location applicability need checking.",
  copied_area_teleport: "New teleport into a copied area; instance and location applicability need checking.",
  destination_violation: "Current non-seasonal transport lands on a blocked tile with no transport starting on that exact tile and plane. No correction is proposed. Seasonal rows are excluded.",
};
export const reconciliationStatuses = ["matches_current", "already_present", "diverged", "missing", "ambiguous", "proposed_new", "possible_existing", "violation"] as const;
export type Category = typeof categories[number];
export type ReconciliationStatus = typeof reconciliationStatuses[number];
export interface Candidate {
  id: string; category: Category; file: string | null; originalLine: number | null;
  kind?: "correction" | "requirement_note" | "addition" | "network_stop" | "destination_violation";
  originalRaw: string | null; suggestedRaw: string;
  original: TransportRow | null; suggested: TransportRow | null;
  proposalHeader?: string; sourceHeader?: string; sourceRaw?: string;
  needs?: string; uncheckedTicks?: string; network?: string | null;
  whatChanges: string; alsoDiffers: string; source: string;
  sourceFile: string; sourceLine: number; sourceRepository: string; sourceCommit: string; upstreamCommit: string;
  reconciliation: { status: ReconciliationStatus; rows: { raw: string; row: TransportRow }[] };
  review: { status: "unreviewed" | "accepted" | "rejected" | "needs_evidence" | "deferred"; explanation?: string; reference?: string };
}
export interface ItemGroup { name: string; itemIds: string; itemNames: string; raw: string; sourceRepository: string; sourceCommit: string; sourceFile: string; sourceLine: number }
export interface Catalogue { candidates: Candidate[]; plugin: Revision; tooling: Revision; itemGroups?: ItemGroup[] }
export interface CandidateUnit { id: string; candidates: Candidate[] }
export const pointText = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "—";
export const candidateKind = (c: Candidate) => c.kind ?? (c.originalRaw === null ? "addition" : c.suggestedRaw === "" ? "requirement_note" : "correction");
export const candidateLabel = (c: Candidate) => {
  const row = c.original ?? c.suggested;
  return row?.label || row?.fields["Display info"] || c.file || c.sourceFile;
};

function pairKey(c: Candidate, reverse = false) {
  const kind = candidateKind(c);
  if (kind === "network_stop" || kind === "requirement_note") return undefined;
  const ends = (row: TransportRow | null) => {
    if (!row?.origin || !row.destination) return undefined;
    const points = [pointText(row.origin), pointText(row.destination)]; return reverse ? points.reverse() : points;
  };
  const suggested = ends(c.suggested), original = c.original ? ends(c.original) : null;
  if (!suggested || c.original && !original) return undefined;
  return JSON.stringify([kind, c.category, c.sourceFile, c.file, c.source, original, suggested]);
}

/** Only mutually unique reverse pairs, in the same source category, file and evidence citation.
 * New proposals pair on their proposed endpoints alone; notes and network stops stay separate.
 * Object IDs/actions can differ between the two directions of a staircase. Proximity never groups rows. */
export function groupCandidates(candidates: Candidate[]): CandidateUnit[] {
  const ordered = [...candidates].sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category)
    || (a.file ?? a.sourceFile).localeCompare(b.file ?? b.sourceFile, "en") || a.id.localeCompare(b.id, "en"));
  const byKey = new Map<string, Candidate[]>();
  for (const c of ordered) {
    const key = pairKey(c);
    if (key) byKey.set(key, [...byKey.get(key) ?? [], c]);
  }
  const pairs = new Map(ordered.map(c => [c.id, (byKey.get(pairKey(c, true) ?? "") ?? []).filter(b => b.id !== c.id)]));
  const seen = new Set<string>();
  return ordered.flatMap(a => {
    if (seen.has(a.id)) return [];
    const matches = pairs.get(a.id)!;
    const b = matches.length === 1 && pairs.get(matches[0].id)?.length === 1 ? matches[0] : undefined;
    seen.add(a.id); if (b) seen.add(b.id);
    return [{ id: a.id, candidates: b ? [a, b] : [a] }];
  });
}

export function filterUnits(units: CandidateUnit[], category: string, status: string, query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return units.filter(unit => unit.candidates.some(c => (!category || c.category === category)
    && (!status || c.reconciliation.status === status)
    && words.every(word => [c.file, c.sourceFile, candidateLabel(c), c.originalRaw, c.suggestedRaw, c.source, c.whatChanges, c.alsoDiffers, c.needs, c.network]
      .join(" ").toLowerCase().includes(word))));
}

export function candidateOverlay(unit: CandidateUnit, collision?: CollisionMap, selected?: string) {
  const overlay = geometryOverlay(unit.candidates.filter(c => candidateKind(c) !== "network_stop")
    .map(c => ({ key: c.id, original: c.original, suggested: c.suggested })), collision, selected);
  const violations = new Set(unit.candidates.filter(c => candidateKind(c) === "destination_violation").map(c => c.id));
  for (const feature of overlay.features) if (violations.has(feature.key)) {
    if (feature.kind === "point" || feature.kind === "edge") feature.title = "Current transport · destination violation";
    if (feature.kind === "point" && feature.role === "destination") {
      feature.tone = "suspect";
      feature.title = "Blocked destination with no exact transport origin · " + pointText(feature.point);
    }
  }
  for (const c of unit.candidates.filter(c => candidateKind(c) === "network_stop")) {
    const row = c.suggested;
    if (row?.origin) overlay.features.push({ kind: "point", key: c.id, point: row.origin, role: "origin", tone: "added", title: "Board at " + pointText(row.origin) });
    if (row?.destination && pointText(row.destination) !== pointText(row.origin)) overlay.features.push({
      kind: "point", key: c.id, point: row.destination, role: "destination", tone: "added", title: "Land at " + pointText(row.destination),
    });
  }
  return overlay;
}

export function displacement(a: WorldPoint | null, b: WorldPoint | null) {
  if (!a || !b) return "not applicable";
  const distance = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return `${distance} tiles (Δx ${b.x - a.x}, Δy ${b.y - a.y})${a.plane !== b.plane ? `; plane ${a.plane} → ${b.plane}` : "; same plane"}`;
}

export const contributorUrl = (c: Candidate) => candidateKind(c) === "destination_violation" ? baselineUrl(c)! : `https://github.com/${c.sourceRepository}/blob/${c.sourceCommit}/bestpath-candidates/${encodeURIComponent(c.sourceFile)}#L${c.sourceLine}`;
export const baselineUrl = (c: Candidate) => c.file ? `https://github.com/${c.sourceRepository}/blob/${c.upstreamCommit}/src/main/resources/transports/${c.file}#L${c.originalLine}` : undefined;
export function fieldComparison(c: Candidate) {
  const before = c.original?.fields ?? {}, after = c.suggested?.fields ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => !["Origin", "Destination"].includes(name))
    .map(name => ({ name, before: before[name] ?? "", after: after[name] ?? "" })).filter(f => f.before || f.after);
}
export const referencedGroups = (c: Candidate, groups: ItemGroup[]) =>
  groups.filter(group => [c.originalRaw, c.suggestedRaw, c.needs, c.whatChanges].join(" ").includes("[" + group.name + "]"));
export function reviewNote(c: Candidate) {
  if (candidateKind(c) === "destination_violation") return `### Destination violation ${c.id}

- Current row: ${baselineUrl(c)}
- Checked plugin: ${c.sourceRepository}@${c.sourceCommit}
- Origin: ${pointText(c.original?.origin)}
- Destination: ${pointText(c.original?.destination)}
- Failure: ${c.whatChanges}
- Current TSV: ${c.originalRaw}
- Proposed correction: none yet
- Decision: needs_evidence
- Explanation / verification evidence:
`;
  return `### Transport candidate ${c.id}

- Source: ${contributorUrl(c)}
- Row: ${c.file ? c.file + ":" + c.originalLine + " at " + c.upstreamCommit : "New proposal; no upstream row"}
- Origin: ${pointText(c.original?.origin)} → ${pointText(c.suggested?.origin)}
- Destination: ${pointText(c.original?.destination)} → ${pointText(c.suggested?.destination)}
- Proposal: ${c.whatChanges}
- Suggested TSV: ${c.suggestedRaw || "No representable replacement supplied"}
- Needs outside the format: ${c.needs || "None recorded"}
- Reconciliation: ${c.reconciliation.status}
- Decision: needs_evidence
- Explanation / verification evidence:
`;
}

export async function loadCandidates(signal: AbortSignal): Promise<Catalogue> {
  const response = await fetch("/api/workbench/v1/candidates", { signal });
  if (!response.ok) throw new Error(`Candidate service answered ${response.status}`);
  return response.json();
}

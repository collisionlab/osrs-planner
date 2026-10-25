import type { TransportRow } from "./api";
import type { Revision } from "./transports";
import { geometryOverlay } from "./review";
import type { CollisionMap } from "../../map/insets/collision";
import type { WorldPoint } from "../../domain/contracts";

export const categories = ["plane", "non_floor", "coordinate_offset"] as const;
export const reconciliationStatuses = ["matches_current", "already_present", "diverged", "missing", "ambiguous"] as const;
export type Category = typeof categories[number];
export type ReconciliationStatus = typeof reconciliationStatuses[number];
export interface Candidate {
  id: string; category: Category; file: string; originalLine: number;
  originalRaw: string; suggestedRaw: string;
  original: TransportRow; suggested: TransportRow;
  whatChanges: string; alsoDiffers: string; source: string;
  sourceFile: string; sourceLine: number; sourceRepository: string; sourceCommit: string; upstreamCommit: string;
  reconciliation: { status: ReconciliationStatus; rows: { raw: string; row: TransportRow }[] };
  review: { status: "unreviewed" | "accepted" | "rejected" | "needs_evidence" | "deferred"; explanation?: string; reference?: string };
}
export interface Catalogue { candidates: Candidate[]; plugin: Revision; tooling: Revision }
export interface CandidateUnit { id: string; candidates: Candidate[] }
export const pointText = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "—";
export const candidateLabel = (c: Candidate) => c.original.label || c.original.fields["Display info"] || c.file;
const same = (a: WorldPoint | null, b: WorldPoint | null) => !!a && !!b && pointText(a) === pointText(b);

/** Only mutually unique reverse pairs, in the same source category, file and evidence citation.
 * Object IDs/actions can differ between the two directions of a staircase. Proximity never groups rows. */
export function groupCandidates(candidates: Candidate[]): CandidateUnit[] {
  const ordered = [...candidates].sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category)
    || a.file.localeCompare(b.file, "en") || a.id.localeCompare(b.id, "en"));
  const pairs = new Map(ordered.map(a => [a.id, ordered.filter(b => a.id !== b.id
    && a.category === b.category && a.sourceFile === b.sourceFile && a.file === b.file && a.source === b.source
    && same(a.original.origin, b.original.destination) && same(a.original.destination, b.original.origin)
    && same(a.suggested.origin, b.suggested.destination) && same(a.suggested.destination, b.suggested.origin))]));
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
    && words.every(word => [c.file, candidateLabel(c), c.originalRaw, c.suggestedRaw, c.source, c.whatChanges, c.alsoDiffers]
      .join(" ").toLowerCase().includes(word))));
}

export function candidateOverlay(unit: CandidateUnit, collision?: CollisionMap, selected?: string) {
  return geometryOverlay(unit.candidates.map(c => ({ key: c.id, original: c.original, suggested: c.suggested })),
    collision, selected);
}

export function displacement(a: WorldPoint | null, b: WorldPoint | null) {
  if (!a || !b) return "not applicable";
  const distance = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return `${distance} tiles (Δx ${b.x - a.x}, Δy ${b.y - a.y})${a.plane !== b.plane ? `; plane ${a.plane} → ${b.plane}` : "; same plane"}`;
}

export const contributorUrl = (c: Candidate) => `https://github.com/${c.sourceRepository}/blob/${c.sourceCommit}/bestpath-candidates/${encodeURIComponent(c.sourceFile)}#L${c.sourceLine}`;
export const baselineUrl = (c: Candidate) => `https://github.com/${c.sourceRepository}/blob/${c.upstreamCommit}/src/main/resources/transports/${c.file}#L${c.originalLine}`;
export function reviewNote(c: Candidate) {
  return `### Transport candidate ${c.id}

- Source: ${contributorUrl(c)}
- Row: ${c.file}:${c.originalLine} at ${c.upstreamCommit}
- Origin: ${pointText(c.original.origin)} → ${pointText(c.suggested.origin)}
- Destination: ${pointText(c.original.destination)} → ${pointText(c.suggested.destination)}
- Proposal: ${c.whatChanges}
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

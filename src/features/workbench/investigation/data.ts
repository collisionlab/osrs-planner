import Ajv from "ajv";
import type { WorldPoint } from "../../../domain/contracts";
import { sha256, type InsetAssets } from "../../../map/insets/assets";
import type { Region } from "../../../map/insets/geometry";
import type { Revision } from "../transports";

/**
 * The inset investigation's data: one pinned inset release (osrs-tiles docs/tiles.md), read as
 * published. `regions.json` and `labels.json` come with the map's assets; `anchors.json`,
 * `review.json` and `investigations.json` are fetched from the same release and checked against its
 * manifest, so nothing here mixes two releases. `investigations.json` (the labeller's worklist:
 * provisional areas, name candidates, issues) is optional; without it the areas are the release's
 * own labels, and only issues the release itself records are shown.
 */

export type Triple = [x: number, y: number, plane: number];
export const tilePoint = ([x, y, plane]: Triple): WorldPoint => ({ x, y, plane });
export const tileText = (point: WorldPoint | Triple) => Array.isArray(point) ? point.join(" ") : `${point.x} ${point.y} ${point.plane}`;

/** Where a name came from: a map label, a GPS destination, a wiki page (osrs-tiles `sources.json`). */
export interface EvidenceRecord {
  id: string; kind: string; name: string; point: Triple; source: string;
  url?: string; row?: number; category?: string; upstreamSource?: string;
}

/** A region's curated area entry (an `annotations.json` component, as `labels.json` publishes it). */
export interface LabelArea { areaKey: string; name: string; status: string; aliases: string[]; evidence: string[]; reason: string; seed: Triple }
export interface RegionLabel { name: string; plane: number; status: "named" | "descriptive" | "unresolved"; areas: LabelArea[] }

export interface Endpoint { kind: string; membership: string; point: Triple; regionId: string | null }
/** A transport row (or curated anchor) the labeller matched to areas. */
export interface Connection {
  id: string; action: string; label: string; policy: string; reason: string; duration: string; entrance?: boolean;
  source: Endpoint | null; target: Endpoint | null; sources: { file: string; line?: number; area?: string }[];
}
export interface Anchor { curated: boolean; entrance: boolean; hops: number; point: Triple; path: { connectionId: string; reversed: boolean }[] }
export interface RegionAnchors { status: string; anchors: Anchor[]; defaultAnchor: number | null; connectionIds: string[] }
export interface AnchorsFile {
  catalogueSha256: string;
  connections: Record<string, Connection>;
  regions: Record<string, RegionAnchors>;
  reachableRegionIds: string[];
  curatedIssues: unknown[];
  policy?: string; reachability?: string; traversal?: string;
}

export type AreaStatus = "named" | "descriptive" | "provisional";
export type Severity = "error" | "warning" | "info";
export interface AreaIssue {
  code: string; severity: Severity; message: string; regionId?: string; point?: Triple; evidence?: string[];
  /** Who says so: the labeller's worklist, the release's `review.json`, or the release's own files. */
  source: "investigations" | "review" | "release";
}
/** A name the labeller suggests for a region, with the evidence it would rest on. A suggestion, not a fact. */
export interface NameCandidate { id: string; name: string; regionId: string; evidence: string[]; reason: string; score?: number }

/** A geographical area: a curated area key's regions, or a provisional (unnamed) one. */
export interface Area {
  id: string;
  status: AreaStatus;
  areaKey?: string;
  name: string;
  aliases: string[];
  regionIds: string[];
  planes: number[];
  tileCount: number;
  relatedAreaIds: string[];
  issues: AreaIssue[];
  candidates: NameCandidate[];
  priority: number;
  /** Some region has an anchor whose surface point is a way in. */
  entrance: boolean;
  /** Some region has an anchor at all (the planner can place it). */
  anchored: boolean;
  /** Some region is reachable through the transport data (anchors.json `reachableRegionIds`). */
  reachable: boolean;
}

export type ArtifactState = { state: "loaded" } | { state: "absent"; reason: string } | { state: "invalid"; reason: string };

export interface InvestigationData {
  assets: InsetAssets;
  regions: Map<string, Region>;
  labels: Record<string, RegionLabel>;
  anchors: AnchorsFile;
  /** Evidence `labels.json` accepted. */
  evidence: Map<string, EvidenceRecord>;
  /** Evidence `investigations.json` suggests for candidates, beyond what is accepted. */
  suggested: Map<string, EvidenceRecord>;
  areas: Area[];
  byId: Map<string, Area>;
  /** The areas each region belongs to. */
  areasOfRegion: Map<string, string[]>;
  investigations: ArtifactState;
  /** The plugin the release's connections were matched from, when `investigations.json` says. */
  plugin?: Revision;
}

const triple = { type: "array", items: { type: "integer" }, minItems: 3, maxItems: 3 };
const strings = { type: "array", items: { type: "string" } };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const evidenceSchema = { type: "object", required: ["id", "kind", "name", "point", "source"],
  properties: { id: { type: "string" }, kind: { type: "string" }, name: { type: "string" }, point: triple, source: { type: "string" } } };
const ajv = new Ajv();
const validateLabelAreas = ajv.compile({ type: "array", items: { type: "object", required: ["areaKey", "name", "evidence", "seed"],
  properties: { areaKey: { type: "string", minLength: 1 }, name: { type: "string" }, aliases: strings, evidence: strings, reason: { type: "string" }, seed: triple } } });
const validateEvidence = ajv.compile(evidenceSchema);
const validateAnchors = ajv.compile({ type: "object", required: ["catalogueSha256", "connections", "regions", "reachableRegionIds"],
  properties: { catalogueSha256: hash, connections: { type: "object" }, regions: { type: "object" }, reachableRegionIds: strings } });

/**
 * `investigations.json` (schemaVersion 1), from osrs-tiles' labeller. Its `*Sha256` fields name the
 * release files it was made from; they must be this release's.
 */
export interface InvestigationsFile {
  schemaVersion: 1;
  catalogueSha256: string;
  labelsSha256: string;
  anchorsSha256: string;
  plugin?: Revision;
  areas: {
    id: string; status: AreaStatus; areaKey: string | null; name: string; aliases: string[]; regionIds: string[];
    relatedAreaIds: string[]; priority: number;
    issues: Omit<AreaIssue, "source">[];
    candidates: NameCandidate[];
  }[];
  evidence: Record<string, EvidenceRecord>;
}
const validateInvestigations = ajv.compile({
  type: "object", required: ["schemaVersion", "catalogueSha256", "labelsSha256", "anchorsSha256", "areas", "evidence"],
  properties: {
    schemaVersion: { const: 1 }, catalogueSha256: hash, labelsSha256: hash, anchorsSha256: hash,
    plugin: { type: "object", required: ["repository", "rev"], properties: { repository: { type: "string" }, rev: { type: "string" } } },
    areas: { type: "array", items: { type: "object",
      required: ["id", "status", "areaKey", "name", "aliases", "regionIds", "relatedAreaIds", "priority", "issues", "candidates"],
      properties: {
        id: { type: "string", pattern: "^(area|provisional|region):[A-Za-z0-9._-]+$" }, status: { enum: ["named", "descriptive", "provisional"] },
        areaKey: { type: ["string", "null"] }, name: { type: "string", minLength: 1 }, aliases: strings,
        regionIds: { type: "array", minItems: 1, items: { type: "string" } }, relatedAreaIds: strings, priority: { type: "number" },
        issues: { type: "array", items: { type: "object", required: ["code", "severity", "message"], properties: {
          code: { type: "string" }, severity: { enum: ["error", "warning", "info"] }, message: { type: "string" },
          regionId: { type: "string" }, point: triple, evidence: strings } } },
        candidates: { type: "array", items: { type: "object", required: ["id", "name", "regionId", "evidence", "reason"], properties: {
          id: { type: "string" }, name: { type: "string" }, regionId: { type: "string" }, evidence: strings, reason: { type: "string" }, score: { type: "number" } } } },
      } } },
    evidence: { type: "object", additionalProperties: evidenceSchema },
  },
});

const SEVERITY: Record<Severity, number> = { error: 1000, warning: 100, info: 10 };
/** Outstanding issues first, worst first; then reachable unnamed areas; then size (at most 6). */
export function basePriority(area: Pick<Area, "issues" | "status" | "reachable" | "tileCount">) {
  return area.issues.reduce((sum, issue) => sum + SEVERITY[issue.severity], 0)
    + (area.status === "provisional" && area.reachable ? 500 : 0) + Math.log10(area.tileCount + 1);
}

/** Check `investigations.json` against the release it claims to be from; throws why not. */
export function checkInvestigations(value: unknown, files: Record<string, string>, regions: Map<string, Region>,
  known: (id: string) => boolean): InvestigationsFile {
  if (!validateInvestigations(value)) throw new Error(`investigations.json does not match schema 1 (${ajv.errorsText(validateInvestigations.errors)})`);
  const file = value as InvestigationsFile;
  for (const [field, name] of [["catalogueSha256", "regions.json"], ["labelsSha256", "labels.json"], ["anchorsSha256", "anchors.json"]] as const) {
    if (file[field] !== files[name]) throw new Error(`investigations.json was made from another ${name} (${file[field].slice(0, 12)}, this release has ${String(files[name]).slice(0, 12)})`);
  }
  const ids = new Set<string>();
  for (const area of file.areas) {
    if (ids.has(area.id)) throw new Error(`investigations.json lists ${area.id} twice`);
    ids.add(area.id);
    const missing = area.regionIds.find(id => !regions.has(id))
      || area.candidates.map(candidate => candidate.regionId).find(id => !regions.has(id))
      || area.issues.map(issue => issue.regionId).find(id => id !== undefined && !regions.has(id));
    if (missing) throw new Error(`investigations.json names region ${missing}, which this release doesn't have`);
    const evidence = [...area.candidates.flatMap(candidate => candidate.evidence), ...area.issues.flatMap(issue => issue.evidence || [])]
      .find(id => !file.evidence[id] && !known(id));
    if (evidence) throw new Error(`investigations.json cites evidence ${evidence}, which neither it nor the release has`);
  }
  const related = file.areas.flatMap(area => area.relatedAreaIds).find(id => !ids.has(id));
  if (related) throw new Error(`investigations.json relates an area to ${related}, which it doesn't list`);
  return file;
}

/** Fetch one of the release's files and check it is the one its manifest lists. */
async function releaseFile(assets: InsetAssets, name: string, signal?: AbortSignal): Promise<unknown> {
  const expected = (assets.manifest.files as Record<string, string | undefined>)[name];
  if (!expected) return undefined;
  const response = await fetch(`${assets.base}/${name}`, { signal });
  if (!response.ok) throw new Error(`${name} unavailable (${response.status})`);
  const raw = await response.text();
  if (await sha256(raw) !== expected) throw new Error(`${name} is not the file this release's manifest lists`);
  return JSON.parse(raw);
}

export async function loadInvestigation(assets: InsetAssets, signal?: AbortSignal): Promise<InvestigationData> {
  const [anchors, review] = await Promise.all([releaseFile(assets, "anchors.json", signal), releaseFile(assets, "review.json", signal).catch(() => undefined)]);
  if (!anchors) throw new Error("This inset release has no anchors.json");
  let investigations: unknown, failure: string | undefined;
  try { investigations = await releaseFile(assets, "investigations.json", signal); }
  catch (error) { if (signal?.aborted) throw error; failure = error instanceof Error ? error.message : String(error); }
  return buildInvestigation(assets, anchors, review, investigations, failure);
}

/** The areas of a release (see {@link loadInvestigation}), from its parsed files. */
export function buildInvestigation(assets: InsetAssets, anchorsValue: unknown, review?: unknown, investigationsValue?: unknown,
  investigationsFailure?: string): InvestigationData {
  if (!validateAnchors(anchorsValue)) throw new Error("anchors.json is not in the expected shape");
  const anchors = anchorsValue as AnchorsFile;
  if (anchors.catalogueSha256 !== assets.manifest.files["regions.json"]) throw new Error("anchors.json was made from another regions.json");
  const regions = new Map(assets.catalogue.regions.map(region => [region.id, region]));
  const labels: Record<string, RegionLabel> = {};
  for (const [id, label] of Object.entries(assets.labels)) {
    const areas = label.areas || [];
    if (!validateLabelAreas(areas)) throw new Error(`labels.json: region ${id} has malformed areas`);
    labels[id] = { name: label.name, plane: label.plane, status: (label.status || "named") as RegionLabel["status"],
      areas: (areas as LabelArea[]).map(area => ({ ...area, aliases: area.aliases || [], reason: area.reason || "", status: area.status || label.status || "named" })) };
  }
  const evidence = new Map<string, EvidenceRecord>();
  for (const [id, record] of Object.entries(assets.evidence || {}) as [string, unknown][]) {
    if (!validateEvidence(record) || (record as unknown as EvidenceRecord).id !== id) throw new Error(`labels.json: evidence ${id} is malformed`);
    evidence.set(id, record as unknown as EvidenceRecord);
  }
  const known = (id: string) => evidence.has(id) || !!anchors.connections[id];

  let file: InvestigationsFile | undefined;
  let state: ArtifactState = investigationsFailure ? { state: "invalid", reason: investigationsFailure }
    : { state: "absent", reason: "This inset release has no investigations.json, so there are no name candidates or worklist issues; areas come from its labels." };
  if (investigationsValue !== undefined && !investigationsFailure) {
    try { file = checkInvestigations(investigationsValue, assets.manifest.files, regions, known); state = { state: "loaded" }; }
    catch (error) { state = { state: "invalid", reason: error instanceof Error ? error.message : String(error) }; }
  }
  const suggested = new Map(Object.entries(file?.evidence || {}).filter(([id]) => !evidence.has(id)));

  const reachable = new Set(anchors.reachableRegionIds);
  const facts = (regionIds: string[]) => {
    const shapes = regionIds.map(id => regions.get(id)!).filter(Boolean);
    const anchored = regionIds.filter(id => anchors.regions[id]?.anchors.length);
    return {
      planes: [...new Set(shapes.map(shape => shape.plane))].sort((a, b) => a - b),
      tileCount: shapes.reduce((sum, shape) => sum + shape.tileCount, 0),
      anchored: anchored.length > 0,
      entrance: regionIds.some(id => anchors.regions[id]?.anchors.some(anchor => anchor.entrance)),
      reachable: regionIds.some(id => reachable.has(id)),
    };
  };
  // What the release itself records about a region: no anchor, a review issue, evidence it doesn't have.
  const reviewIssues = new Map<string, AreaIssue[]>();
  const reviewed = review && typeof review === "object" ? (review as { issues?: unknown[] }).issues : undefined;
  for (const issue of [...Array.isArray(reviewed) ? reviewed : [], ...anchors.curatedIssues || []]) {
    if (!issue || typeof issue !== "object") continue;
    const record = issue as Record<string, unknown>;
    const regionId = typeof record.regionId === "string" ? record.regionId : undefined;
    const entry: AreaIssue = { code: String(record.code ?? record.kind ?? "review"), severity: "warning", source: "review",
      message: typeof record.message === "string" ? record.message : typeof record.reason === "string" ? record.reason : JSON.stringify(record), regionId };
    reviewIssues.set(regionId || "", [...reviewIssues.get(regionId || "") || [], entry]);
  }
  const releaseIssues = (regionIds: string[], named: boolean): AreaIssue[] => regionIds.flatMap(regionId => {
    const issues: AreaIssue[] = [...reviewIssues.get(regionId) || []];
    const entry = anchors.regions[regionId];
    if (named && !entry?.anchors.length) issues.push({ code: "no-anchor", severity: "warning", source: "release", regionId,
      message: "Named, but no anchor: the planner can't place it beside the surface." });
    else if (named && !entry.anchors.some(anchor => anchor.entrance)) issues.push({ code: "no-entrance", severity: "info", source: "release", regionId,
      message: "Placed by an anchor that isn't a way in (a teleport or a curated placement): no physical entrance is known." });
    if (!named && reachable.has(regionId)) issues.push({ code: "unnamed-reachable", severity: "error", source: "release", regionId,
      message: "Transports reach it, but it has no name." });
    const dangling = (labels[regionId]?.areas || []).flatMap(area => area.evidence).filter(id => !known(id));
    if (dangling.length) issues.push({ code: "missing-evidence", severity: "warning", source: "release", regionId, evidence: dangling,
      message: `Cites evidence the release doesn't publish: ${dangling.join(", ")}.` });
    return issues;
  });

  let areas: Area[];
  if (file) {
    areas = file.areas.map(record => {
      const area: Area = { id: record.id, status: record.status, areaKey: record.areaKey || undefined, name: record.name, aliases: record.aliases,
        regionIds: record.regionIds, relatedAreaIds: record.relatedAreaIds, candidates: record.candidates, priority: record.priority,
        issues: [...record.issues.map(issue => ({ ...issue, source: "investigations" as const })),
          ...record.regionIds.flatMap(id => reviewIssues.get(id) || [])],
        ...facts(record.regionIds) };
      return area;
    });
  } else {
    const byKey = new Map<string, { label: LabelArea; status: RegionLabel["status"]; regionIds: string[] }>();
    const provisional: string[] = [];
    for (const [id, label] of Object.entries(labels)) {
      if (regions.get(id)?.classification !== "inset") continue;
      if (label.status === "unresolved" || !label.areas.length) { provisional.push(id); continue; }
      for (const area of label.areas) {
        const entry = byKey.get(area.areaKey) || { label: area, status: label.status, regionIds: [] };
        entry.regionIds.push(id); byKey.set(area.areaKey, entry);
      }
    }
    areas = [
      ...[...byKey].map(([areaKey, { label, status, regionIds }]) => ({ id: `area:${areaKey}`, status: status === "descriptive" ? "descriptive" as const : "named" as const,
        areaKey, name: label.name, aliases: label.aliases, regionIds: regionIds.sort(), relatedAreaIds: [], candidates: [],
        issues: releaseIssues(regionIds, true), priority: 0, ...facts(regionIds) })),
      ...provisional.map(id => ({ id: `region:${id}`, status: "provisional" as const, name: labels[id].name, aliases: [], regionIds: [id],
        relatedAreaIds: [], candidates: [], issues: releaseIssues([id], false), priority: 0, ...facts([id]) })),
    ];
    areas.forEach(area => { area.priority = basePriority(area); });
  }
  const areasOfRegion = new Map<string, string[]>();
  for (const area of areas) for (const id of area.regionIds) areasOfRegion.set(id, [...areasOfRegion.get(id) || [], area.id]);
  if (!file) {
    // Related: the areas the release's connections join this one to.
    for (const area of areas) {
      const related = new Set<string>();
      for (const id of area.regionIds) for (const connectionId of anchors.regions[id]?.connectionIds || []) {
        const connection = anchors.connections[connectionId];
        for (const end of [connection?.source, connection?.target]) for (const other of areasOfRegion.get(end?.regionId || "") || []) if (other !== area.id) related.add(other);
      }
      area.relatedAreaIds = [...related].slice(0, 24);
    }
  }
  areas.sort(compareAreas);
  return { assets, regions, labels, anchors, evidence, suggested, areas, byId: new Map(areas.map(area => [area.id, area])), areasOfRegion,
    investigations: state, plugin: file?.plugin };
}

export const compareAreas = (a: Area, b: Area) => b.priority - a.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The evidence record behind an id: accepted, suggested, or a matched connection (as a record of where it is). */
export function evidenceOf(data: InvestigationData, id: string): (EvidenceRecord & { accepted: boolean }) | undefined {
  const record = data.evidence.get(id);
  if (record) return { ...record, accepted: true };
  const suggestion = data.suggested.get(id);
  if (suggestion) return { ...suggestion, accepted: false };
  const connection = data.anchors.connections[id];
  const end = connection?.target?.point || connection?.source?.point;
  if (!connection || !end) return undefined;
  const row = connection.sources.find(source => source.line);
  return { id, kind: "connection", name: connection.action || connection.label || connection.reason, point: end, accepted: true,
    source: row ? `${row.file}:${row.line}` : connection.sources.map(source => source.file).join(", ") };
}

/** An area's filters (see the area browser). */
export interface AreaFilter {
  text?: string;
  status?: AreaStatus;
  plane?: number;
  /** At least this many tiles. */
  minTiles?: number;
  /** `issues`: any outstanding issue; `no-entrance`; `multi-floor`; `topology`: a possible gap. */
  flag?: "issues" | "no-entrance" | "multi-floor" | "topology" | "evidence";
}

export const hasTopologyGap = (area: Area, gaps?: Set<string>) => area.issues.some(issue => issue.code === "possible-topology-gap") || !!gaps?.has(area.id);
export const hasEvidenceIssue = (area: Area) => area.candidates.length > 0 || area.issues.some(issue => /evidence|name/.test(issue.code));

export function filterAreas(areas: Area[], filter: AreaFilter, gaps?: Set<string>): Area[] {
  const text = filter.text?.trim().toLowerCase();
  return areas.filter(area => (!text || area.name.toLowerCase().includes(text) || area.id.toLowerCase().includes(text)
      || area.aliases.some(alias => alias.toLowerCase().includes(text)) || area.regionIds.some(id => id.includes(text)))
    && (!filter.status || area.status === filter.status)
    && (filter.plane === undefined || area.planes.includes(filter.plane))
    && (!filter.minTiles || area.tileCount >= filter.minTiles)
    && (!filter.flag || (filter.flag === "issues" ? area.issues.length > 0 : filter.flag === "no-entrance" ? !area.entrance
      : filter.flag === "multi-floor" ? area.planes.length > 1 : filter.flag === "topology" ? hasTopologyGap(area, gaps) : hasEvidenceIssue(area))));
}

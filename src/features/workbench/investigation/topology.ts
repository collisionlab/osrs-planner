import Ajv from "ajv";
import type { WorldPoint } from "../../../domain/contracts";
import { contains, type Region } from "../../../map/insets/geometry";
import type { Revision } from "../transports";
import { tilePoint, type Area, type Triple } from "./data";

/**
 * shortest-path-tooling's topology report (schemaVersion 1), as the planner service serves it: the
 * walking components it flooded from the collision map, which of them some chain of transports
 * reaches, links its checks suggest are missing, and transport ends that look wrong. It is made
 * separately from the inset release, so it is joined to inset regions only by coordinates, and only
 * trusted where both were made from the same cache and the same transports. Nothing here floods
 * anything itself.
 */

export interface Component {
  id: string;
  plane: number;
  /** Inclusive tile bounds. */
  bounds: [x1: number, y1: number, x2: number, y2: number];
  tileCount: number;
  /** Some of its tiles, to place it; every tile only when `mask` is given. */
  samples: Triple[];
  /** Its exact tiles as rectangles [x, y, width, height], when the report includes them. */
  mask?: [number, number, number, number][];
  /** Some chain of transports reaches it from the report's origin, whatever their requirements. */
  reachable: boolean;
  /** Large enough that the report thinks it matters. */
  significant: boolean;
  transports: { incoming: number; outgoing: number };
}
export interface SourceRow { file: string; line: number }
export interface CandidateEvidence { kind: string; text: string; point?: Triple; source?: SourceRow }
export interface LinkCandidate {
  id: string;
  from: { point: Triple; componentId?: string };
  to: { point: Triple; componentId?: string };
  /** `supported`: the report's checks agree on it; `insufficient`: a lead, not a conclusion. */
  support: "supported" | "insufficient";
  reasons: string[];
  evidence: CandidateEvidence[];
  sources: SourceRow[];
}
export interface SuspectEndpoint { id: string; point: Triple; role: "origin" | "destination"; label: string; reasons: string[]; sources: SourceRow[] }
export interface TopologyReport {
  schemaVersion: 1;
  generator: Revision;
  plugin: Revision;
  collision: { cacheId: number; dumperRev: string };
  origin: Triple;
  /** What `reachable` means in this report, in its own words. */
  reachability: string;
  components: Component[];
  candidates: LinkCandidate[];
  suspiciousEndpoints: SuspectEndpoint[];
}

const triple = { type: "array", items: { type: "integer" }, minItems: 3, maxItems: 3 };
const revision = { type: "object", required: ["repository", "rev"], properties: { repository: { type: "string" }, rev: { type: "string" } } };
const rows = { type: "array", items: { type: "object", required: ["file", "line"], properties: { file: { type: "string" }, line: { type: "integer" } } } };
const end = { type: "object", required: ["point"], properties: { point: triple, componentId: { type: "string" } } };
const ajv = new Ajv();
const validate = ajv.compile({
  type: "object", required: ["schemaVersion", "generator", "plugin", "collision", "origin", "reachability", "components", "candidates", "suspiciousEndpoints"],
  properties: {
    schemaVersion: { const: 1 }, generator: revision, plugin: revision, origin: triple, reachability: { type: "string" },
    collision: { type: "object", required: ["cacheId", "dumperRev"], properties: { cacheId: { type: "integer" }, dumperRev: { type: "string" } } },
    components: { type: "array", items: { type: "object", required: ["id", "plane", "bounds", "tileCount", "samples", "reachable", "significant", "transports"], properties: {
      id: { type: "string" }, plane: { type: "integer", minimum: 0, maximum: 3 }, bounds: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
      tileCount: { type: "integer", minimum: 1 }, samples: { type: "array", items: triple },
      mask: { type: "array", items: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 } },
      reachable: { type: "boolean" }, significant: { type: "boolean" },
      transports: { type: "object", required: ["incoming", "outgoing"], properties: { incoming: { type: "integer" }, outgoing: { type: "integer" } } } } } },
    candidates: { type: "array", items: { type: "object", required: ["id", "from", "to", "support", "reasons", "evidence", "sources"], properties: {
      id: { type: "string" }, from: end, to: end, support: { enum: ["supported", "insufficient"] }, reasons: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "object", required: ["kind", "text"], properties: { kind: { type: "string" }, text: { type: "string" }, point: triple } } },
      sources: rows } } },
    suspiciousEndpoints: { type: "array", items: { type: "object", required: ["id", "point", "role", "label", "reasons", "sources"], properties: {
      id: { type: "string" }, point: triple, role: { enum: ["origin", "destination"] }, label: { type: "string" }, reasons: { type: "array", items: { type: "string" } }, sources: rows } } },
  },
});

export function checkReport(value: unknown): TopologyReport {
  if (!validate(value)) throw new Error(`The topology report does not match schema 1 (${ajv.errorsText(validate.errors)})`);
  const report = value as TopologyReport;
  const ids = new Set(report.components.map(component => component.id));
  if (ids.size !== report.components.length) throw new Error("The topology report lists a component twice");
  const unknown = report.candidates.flatMap(candidate => [candidate.from.componentId, candidate.to.componentId]).find(id => id !== undefined && !ids.has(id));
  if (unknown) throw new Error(`The topology report links component ${unknown}, which it doesn't list`);
  return report;
}

export type TopologyState =
  | { state: "loading" }
  | { state: "unavailable"; reason: string }
  | { state: "invalid"; reason: string }
  | { state: "loaded"; report: TopologyReport };

/** The report, or why there is none. A missing report is never made up from what else is loaded. */
export async function loadTopology(signal?: AbortSignal): Promise<TopologyState> {
  let response: Response;
  try { response = await fetch("/api/workbench/v1/topology", { signal }); }
  catch (error) { if (signal?.aborted) throw error; return { state: "unavailable", reason: "The planner service could not be reached." }; }
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = undefined; }
  if (!response.ok || body === undefined) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : undefined;
    return { state: "unavailable", reason: message || `No topology report (the service answered ${response.status}).` };
  }
  try { return { state: "loaded", report: checkReport(body) }; }
  catch (error) { return { state: "invalid", reason: error instanceof Error ? error.message : String(error) }; }
}

export interface Check { subject: string; ok: boolean | undefined; text: string }
/**
 * Whether the report belongs with what it is shown over: the inset release's cache (its components
 * are joined to inset regions by tile) and the transport data the explorer shows (its candidates and
 * suspects are about those transports). Until every check passes, its conclusions are unverified.
 */
export function reportChecks(report: TopologyReport, context: { cacheId?: number; plugin?: Revision; collisionDumperRev?: string }): { checks: Check[]; verified: boolean } {
  const short = (rev?: string) => rev ? rev.slice(0, 7) : "unknown";
  const checks: Check[] = [];
  checks.push(context.cacheId === undefined ? { subject: "Cache", ok: undefined, text: `report flooded cache ${report.collision.cacheId}; the insets' cache is unknown` }
    : report.collision.cacheId === context.cacheId ? { subject: "Cache", ok: true, text: `cache ${report.collision.cacheId}, as the insets` }
    : { subject: "Cache", ok: false, text: `report flooded cache ${report.collision.cacheId}, but these insets were cut from cache ${context.cacheId}: its components may not lie where these regions are` });
  checks.push(!context.plugin || context.plugin.rev === "unknown" ? { subject: "Transports", ok: undefined, text: `report used ${report.plugin.repository}@${short(report.plugin.rev)}; the explorer's plugin is unknown` }
    : context.plugin.rev === report.plugin.rev ? { subject: "Transports", ok: true, text: `${report.plugin.repository}@${short(report.plugin.rev)}, as the explorer` }
    : { subject: "Transports", ok: false, text: `report used ${report.plugin.repository}@${short(report.plugin.rev)}, the explorer shows @${short(context.plugin.rev)}: its candidates and suspects may already be fixed, or new ones missing` });
  if (context.collisionDumperRev) checks.push(context.collisionDumperRev === report.collision.dumperRev
    ? { subject: "Collision", ok: true, text: `dumped by tooling@${short(report.collision.dumperRev)}, as the map's collision` }
    : { subject: "Collision", ok: false, text: `report's collision was dumped by tooling@${short(report.collision.dumperRev)}, the map's by @${short(context.collisionDumperRev)}: walls drawn may not be those it flooded` });
  return { checks, verified: checks.every(check => check.ok === true) };
}

const inBounds = ({ bounds: [x1, y1, x2, y2] }: Pick<Component, "bounds">, point: WorldPoint) =>
  point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2;
const meets = (component: Component, region: Region) => component.plane === region.plane
  && component.bounds[0] < region.bounds[2] && region.bounds[0] <= component.bounds[2] && component.bounds[1] < region.bounds[3] && region.bounds[1] <= component.bounds[3];

/** Whether a component holds a tile: exactly with a mask, else only by its bounds. */
export function componentHolds(component: Component, point: WorldPoint): "tile" | "bounds" | undefined {
  if (point.plane !== component.plane || !inBounds(component, point)) return undefined;
  if (!component.mask) return component.samples.some(([x, y]) => x === point.x && y === point.y) ? "tile" : "bounds";
  return component.mask.some(([x, y, w, h]) => point.x >= x && point.x < x + w && point.y >= y && point.y < y + h) ? "tile" : undefined;
}

export interface AreaTopology {
  /** Components on the area's tiles: `tiles` where one of its known tiles is in the area, `bounds` where only its bounds overlap. */
  components: { component: Component; overlap: "tiles" | "bounds" }[];
  /** Tiny components left out (not significant). */
  fragments: number;
  candidates: LinkCandidate[];
  suspects: SuspectEndpoint[];
}

/** The report's parts that are about an area, found by coordinates in the area's regions' masks. */
export function areaTopology(report: TopologyReport, area: Area, regions: Map<string, Region>): AreaTopology {
  const shapes = area.regionIds.map(id => regions.get(id)).filter((shape): shape is Region => !!shape);
  const inArea = (point: Triple) => shapes.some(shape => contains(shape, point[0], point[1], point[2]));
  const components: AreaTopology["components"] = [];
  let fragments = 0;
  for (const component of report.components) {
    if (!shapes.some(shape => meets(component, shape))) continue;
    const tiles = component.mask
      ? shapes.some(shape => component.mask!.some(([x, y, w, h]) => shape.mask.some(([a, b, c, d]) => shape.plane === component.plane && x < a + c && a < x + w && y < b + d && b < y + h)))
      : component.samples.some(inArea);
    if (!component.significant) { fragments++; continue; }
    components.push({ component, overlap: tiles ? "tiles" : "bounds" });
  }
  components.sort((a, b) => Number(a.component.reachable) - Number(b.component.reachable) || b.component.tileCount - a.component.tileCount);
  return { components, fragments,
    candidates: report.candidates.filter(candidate => inArea(candidate.from.point) || inArea(candidate.to.point)),
    suspects: report.suspiciousEndpoints.filter(suspect => inArea(suspect.point)) };
}

/**
 * Areas with a possible gap: a candidate link starts or ends in them, or a significant component no
 * transport reaches has a known tile in them. Found by classifying the report's tiles into regions.
 */
export function gapAreas(report: TopologyReport, areasOfRegion: Map<string, string[]>, classify: (point: WorldPoint) => string): Set<string> {
  const gaps = new Set<string>();
  const mark = (point: Triple) => (areasOfRegion.get(classify(tilePoint(point))) || []).forEach(id => gaps.add(id));
  for (const candidate of report.candidates) { mark(candidate.from.point); mark(candidate.to.point); }
  for (const component of report.components) if (component.significant && !component.reachable) component.samples.forEach(mark);
  return gaps;
}

/** Plain words for the report's reason codes; unknown codes are shown as they are. */
export const REASONS: Record<string, string> = {
  "unreachable-component": "No chain of transports reaches this walking component.",
  "facing-endpoints": "Two transport ends face each other across a wall with nothing joining them.",
  "one-way-only": "A transport leads in, but nothing leads back out.",
  "object-without-transport": "A map object with an action stands here, and no transport uses it.",
  "label-suggests-exit": "A map label or wiki page names an exit here.",
  "destination-blocked": "The transport lands on a blocked tile.",
  "origin-unreachable": "Nothing reaches the transport's origin.",
  "plane-mismatch": "The same place is given on different planes by different rows.",
};
export const reasonText = (code: string) => REASONS[code] || code;
export const tile = tilePoint;

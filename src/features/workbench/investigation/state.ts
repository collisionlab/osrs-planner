import type { WorldPoint } from "../../../domain/contracts";

/** What the investigation page's URL holds, so a link opens the same area, region, item and view. */
export interface InvestigationState {
  /** An area id (`area:<key>`, `region:<id>`, `provisional:<id>`). */
  area?: string;
  /** The inset region selected within it. */
  region?: string;
  mode: "topology" | "labelling";
  /** The selected candidate, suspect, component, evidence or connection, by its id. */
  item?: string;
  /** The plane shown. */
  plane?: number;
  at?: { point: WorldPoint; zoom: number };
  /** Regions beside their entrances (as the planner shows them) rather than where they really are. */
  beside?: boolean;
  /** The inset release the ids are from (its version's first 12 characters). */
  release?: string;
  /** The area browser's filters. */
  q?: string;
}

const POINT = /^(\d{1,5}),(\d{1,5}),([0-3])$/;
const ID = /^[A-Za-z0-9:._-]{1,160}$/;

export function readState(search: string): InvestigationState {
  const params = new URLSearchParams(search);
  const state: InvestigationState = { mode: params.get("mode") === "labelling" ? "labelling" : "topology" };
  for (const [key, name] of [["area", "area"], ["region", "region"], ["item", "sel"]] as const) {
    const value = params.get(name);
    if (value && ID.test(value)) state[key] = value;
  }
  const plane = params.get("plane");
  if (plane && /^[0-3]$/.test(plane)) state.plane = Number(plane);
  const at = POINT.exec(params.get("at") || ""), zoom = Number(params.get("z"));
  if (at) state.at = { point: { x: Number(at[1]), y: Number(at[2]), plane: Number(at[3]) }, zoom: zoom >= 4 && zoom <= 11 ? Math.round(zoom) : 8 };
  if (params.get("place") === "entrance") state.beside = true;
  const release = params.get("v");
  if (release && /^[0-9a-f]{6,24}$/.test(release)) state.release = release;
  const q = params.get("q");
  if (q) state.q = q;
  return state;
}

export function writeState(state: InvestigationState): string {
  const params = new URLSearchParams();
  if (state.area) params.set("area", state.area);
  if (state.region) params.set("region", state.region);
  if (state.mode === "labelling") params.set("mode", "labelling");
  if (state.item) params.set("sel", state.item);
  if (state.plane !== undefined) params.set("plane", String(state.plane));
  if (state.at) { params.set("at", `${state.at.point.x},${state.at.point.y},${state.at.point.plane}`); params.set("z", String(state.at.zoom)); }
  if (state.beside) params.set("place", "entrance");
  if (state.release) params.set("v", state.release);
  if (state.q) params.set("q", state.q);
  const text = params.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  return text ? `?${text}` : "";
}

export const releaseId = (version: string) => version.slice(0, 12);

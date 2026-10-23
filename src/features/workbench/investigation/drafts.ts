import type { WorldPoint } from "../../../domain/contracts";
import { contains, type Region } from "../../../map/insets/geometry";
import type { Triple } from "./data";

/**
 * Drafts a developer prepares from an investigation, to copy into a pull request by hand. Nothing
 * here is written anywhere, and nothing unknown is filled in: a field the evidence doesn't settle
 * is marked for investigation, so a draft can't be pasted in as if it were finished.
 */

export const INVESTIGATE = "INVESTIGATE";
const todo = (what: string) => `${INVESTIGATE}(${what})`;

/** The plugin's `transports.tsv` columns, in order. */
export const TRANSPORT_COLUMNS = ["Origin", "Destination", "menuOption menuTarget objectID", "Skills", "Items", "Quests", "Varbits", "VarPlayers", "Duration", "Display info"] as const;

export interface TransportDraft {
  /** Each column's value: known, empty (none), or marked for investigation. */
  fields: Record<(typeof TRANSPORT_COLUMNS)[number], string>;
  /** The fields still to find out. */
  unknown: string[];
  /** A `transports.tsv` row, with its header, that fails review until the unknowns are filled in. */
  tsv: string;
}

const tsvPoint = (point: WorldPoint) => `${point.x} ${point.y} ${point.plane}`;

/** A candidate transport row between two tiles: only the tiles are known. */
export function transportDraft(origin: WorldPoint, destination: WorldPoint, notes?: { action?: string; objectId?: string }): TransportDraft {
  const action = notes?.action?.trim(), objectId = notes?.objectId?.trim();
  const fields = {
    Origin: tsvPoint(origin), Destination: tsvPoint(destination),
    "menuOption menuTarget objectID": action && objectId && /^\d+$/.test(objectId) ? `${action} ${objectId}` : todo(`menu option, target and object id${action ? `; seen: ${action}` : ""}${objectId ? `; object ${objectId}` : ""}`),
    Skills: todo("skill requirements"), Items: todo("item requirements"), Quests: todo("quest requirements"),
    Varbits: todo("varbit checks"), VarPlayers: todo("varplayer checks"), Duration: todo("duration in ticks"), "Display info": "",
  };
  const unknown = Object.entries(fields).filter(([, value]) => value.startsWith(INVESTIGATE)).map(([name]) => name);
  return { fields, unknown, tsv: `# ${TRANSPORT_COLUMNS.join("\t")}\n${TRANSPORT_COLUMNS.map(column => fields[column]).join("\t")}` };
}

export interface CorrectionInput {
  /** The curated area key (`taverley-dungeon`); a new one for a new area. */
  key: string;
  name: string;
  /** `named`, or `descriptive` for a name that describes rather than names. */
  status: "named" | "descriptive";
  regionId?: string;
  seed?: WorldPoint;
  evidence: string[];
  justification: string;
  anchor?: { point?: WorldPoint; reason: string; entrance: boolean };
}

/** An `annotations.json` area entry with one component, as osrs-tiles' labeller reads it. */
export interface AnnotationDraft {
  key: string; name: string; status: string; reason: string;
  components: { componentId: string; seed: Triple; evidence: string[]; reason: string; anchor?: { point: Triple; reason: string; entrance: boolean } }[];
}

export const areaKey = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * The draft and what stops it being one: a name, a region, a seed inside the region's terrain, at
 * least one piece of evidence and a justification. Evidence is only ever what the developer chose.
 */
export function correctionDraft(input: CorrectionInput, regions: Map<string, Region>): { draft?: AnnotationDraft; problems: string[] } {
  const problems: string[] = [];
  const region = input.regionId ? regions.get(input.regionId) : undefined;
  if (!input.name.trim()) problems.push("Give a name.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.key)) problems.push("Give an area key in lower case with dashes (like taverley-dungeon).");
  if (!region) problems.push("Choose the region the name is for.");
  if (!input.seed) problems.push("Choose a seed tile inside the region.");
  else if (region && !contains(region, input.seed.x, input.seed.y, input.seed.plane)) problems.push(`The seed ${tsvPoint(input.seed)} is not on ${region.id}'s terrain.`);
  if (!input.evidence.length) problems.push("Choose the evidence the name rests on; none is chosen for you.");
  if (!input.justification.trim()) problems.push("Say why the evidence identifies this region.");
  if (input.anchor && (input.anchor.point || input.anchor.reason.trim())) {
    if (!input.anchor.point) problems.push("Give the anchor's point, or clear its reason.");
    if (!input.anchor.reason.trim()) problems.push("Say why the area hangs off the anchor's point.");
  }
  if (problems.length || !region || !input.seed) return { problems };
  const anchor = input.anchor?.point && input.anchor.reason.trim()
    ? { point: [input.anchor.point.x, input.anchor.point.y, input.anchor.point.plane] as Triple, reason: input.anchor.reason.trim(), entrance: input.anchor.entrance } : undefined;
  return { problems, draft: {
    key: input.key, name: input.name.trim(), status: input.status, reason: input.justification.trim(),
    components: [{ componentId: region.id, seed: [input.seed.x, input.seed.y, input.seed.plane], evidence: [...input.evidence],
      reason: input.justification.trim(), ...anchor ? { anchor } : {} }],
  } };
}

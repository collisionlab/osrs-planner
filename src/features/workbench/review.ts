import type { WorldPoint } from "../../domain/contracts";
import type { CollisionMap } from "../../map/insets/collision";
import { featurePoints, type FeatureOverlay, type FeatureTone, type MapFeature } from "../../map/insets/features";
import type { ReviewUnit, RowChange, TransportRow } from "./api";

/** One transport's edge and endpoint tiles, shared by PR review and candidate inspection. */
function rowGeometry(key: string, row: TransportRow, tone: FeatureTone, omitUnchanged?: TransportRow, dashedPoints?: boolean): MapFeature[] {
  const features: MapFeature[] = [];
  const where = (point?: WorldPoint | null) => point ? `${point.x} ${point.y} ${point.plane}` : "anywhere";
  const title = `${tone === "removed" ? "Removed" : tone === "added" ? "Added" : "Edited"} row\n${where(row.origin)} → ${where(row.destination)}`;
  if (row.origin && row.destination) features.push({ kind: "edge", key, from: row.origin, to: row.destination,
    tone, dashed: tone === "removed", title });
  for (const role of ["origin", "destination"] as const) {
    const point = row[role];
    if (point && !(omitUnchanged && samePoint(point, omitUnchanged[role]))) {
      features.push({ kind: "point", key, point, tone, role, title, ...(dashedPoints === undefined ? {} : { dashed: dashedPoints }) });
    }
  }
  return features;
}

/** Shared old/proposed transport drawing, independent of GitHub's review domain. */
export function geometryOverlay(rows: { key: string; original: TransportRow | null; suggested: TransportRow | null }[],
  collision?: CollisionMap, selected?: string): FeatureOverlay {
  const features: MapFeature[] = [];
  for (const { key, original, suggested } of rows) {
    if (original && suggested && (!samePoint(original.origin, suggested.origin) || !samePoint(original.destination, suggested.destination))) {
      features.push(...rowGeometry(key, original, "removed", suggested, true));
      features.push(...rowGeometry(key, suggested, "added", undefined, false));
    } else if (suggested || original) features.push(...rowGeometry(key, (suggested ?? original)!, original ? "changed" : "added"));
  }
  return { features, anchors: features, collision, selected };
}

const samePoint = (a?: WorldPoint | null, b?: WorldPoint | null) => a?.x === b?.x && a?.y === b?.y && a?.plane === b?.plane;

/** A row's features carry its index in the unit, so a click on the map selects the row. */
export const changeKey = (unit: ReviewUnit, change: RowChange) => `${unit.id}/${unit.changes.indexOf(change)}`;
export const changeOfKey = (unit: ReviewUnit, key?: string) => unit.changes.find(change => changeKey(unit, change) === key);

/**
 * A review unit as the inset map draws it: each row's edge (added, removed or edited; a moved row
 * shows where it was too) and its tiles. They are all anchors, so the map lays out the areas they
 * cross (an area reached only through this pull request is placed beside the entrance it adds) and
 * draws collision around them.
 */
export function unitOverlay(unit: ReviewUnit, collision?: CollisionMap, selected?: RowChange): FeatureOverlay {
  const features: MapFeature[] = [];
  const draw = (change: RowChange, version: "base" | "head", tone: "added" | "removed" | "changed") => {
    features.push(...rowGeometry(changeKey(unit, change), change[version]!, tone));
  };
  for (const change of unit.changes) {
    if (change.kind === "changed" && (!samePoint(change.base!.origin, change.head!.origin)
      || !samePoint(change.base!.destination, change.head!.destination))) draw(change, "base", "removed");
    draw(change, change.head ? "head" : "base", change.kind);
  }
  // An area the inset release hasn't named takes the pull request's own heading for it.
  const names = features.filter(feature => feature.kind === "point").flatMap(featurePoints).map(point => ({ point, name: `${unit.title} (from PR)` }));
  return { features, anchors: features, collision, names, selected: selected && changeKey(unit, selected) };
}

/** Every tile the unit touches, to load collision around. */
export const unitPoints = (unit: ReviewUnit) => unitOverlay(unit).features.filter(feature => feature.kind === "point").flatMap(featurePoints);

import type { WorldPoint } from "../../domain/contracts";
import type { CollisionMap } from "../../map/insets/collision";
import { featurePoints, type FeatureOverlay, type MapFeature } from "../../map/insets/features";
import type { ReviewUnit, RowChange } from "./api";

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
    const { origin, destination } = change[version]!;
    const key = changeKey(unit, change);
    if (origin && destination) features.push({ kind: "edge", key, from: origin, to: destination, tone, dashed: tone === "removed" });
    if (origin) features.push({ kind: "point", key, point: origin, tone, role: "origin" });
    if (destination) features.push({ kind: "point", key, point: destination, tone, role: "destination" });
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

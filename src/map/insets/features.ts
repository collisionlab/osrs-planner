import type { WorldPoint } from "../../domain/contracts";
import type { CollisionMap } from "./collision";
import type { RegionLink } from "./layout";

/**
 * What a tool draws over the inset map besides a route: a small set of geographical features, each
 * belonging to a selectable item by `key` (a review row, a transport). A route stays a route; these
 * are not one, so they never pretend to be.
 */
export type FeatureTone =
  /** A transport row a pull request adds, removes or edits. */
  | "added" | "removed" | "changed"
  /** A transport by what it is: an object used where it stands, a journey, or a teleport. */
  | "object" | "journey" | "teleport"
  /** Many items counted together, too many to draw at this zoom. */
  | "count";

export type MapFeature =
  /** From one tile to another, with an arrowhead at `to`; dashed for a removed row. */
  | { kind: "edge"; key: string; from: WorldPoint; to: WorldPoint; tone: FeatureTone; dashed?: boolean }
  /** A tile: an origin is outlined, a destination filled. */
  | { kind: "point"; key: string; point: WorldPoint; tone: FeatureTone; role: "origin" | "destination" }
  /** A rectangle of tiles (inclusive), labelled; `key` selects it like any feature. */
  | { kind: "region"; key: string; plane: number; bounds: [number, number, number, number]; tone: FeatureTone; label?: string };

export interface FeatureOverlay {
  features: MapFeature[];
  /**
   * The features this view is about: their areas are laid out as insets (an edge into an area puts it
   * beside its entrance), the view opens on them, and collision is drawn around their tiles. Other
   * features are drawn only where their tiles already are on the map.
   */
  anchors: MapFeature[];
  selected?: string;
  /** Blocked tiles and walls around the anchors, when zoomed in far enough to see single tiles. */
  collision?: CollisionMap;
  /** Names for the areas these points are in, where the inset release hasn't named them. */
  names?: { point: WorldPoint; name: string }[];
}

export function featurePoints(feature: MapFeature): WorldPoint[] {
  if (feature.kind === "edge") return [feature.from, feature.to];
  if (feature.kind === "point") return [feature.point];
  const [x1, y1, x2, y2] = feature.bounds;
  return [{ x: x1, y: y1, plane: feature.plane }, { x: x2, y: y2, plane: feature.plane }];
}

/** The features of one item. */
export const featuresOf = (features: MapFeature[], key?: string) => key === undefined ? [] : features.filter(feature => feature.key === key);

/** The items hit, each once, in drawing order (topmost last becomes first). */
export function keysHit(hits: { key?: string }[]): string[] {
  return [...new Set(hits.map(hit => hit.key).filter((key): key is string => !!key))];
}

/** Edges between two areas, as crossings that place one area beside the other. */
export function edgeLinks(features: MapFeature[], classify: (point: WorldPoint) => string): RegionLink[] {
  return features.flatMap(feature => {
    if (feature.kind !== "edge") return [];
    const fromRegion = classify(feature.from), toRegion = classify(feature.to);
    return fromRegion === toRegion ? [] : [{ fromRegion, toRegion, source: { kind: "transport", from: feature.from, to: feature.to } }];
  });
}

/** A stable description of the anchors' tiles, to tell whether a new overlay is about something else. */
export const anchorsKey = (overlay?: FeatureOverlay) => overlay ? JSON.stringify(overlay.anchors.map(featurePoints)) : "";

/**
 * What the insets are laid out from: the areas the anchors reach beyond the ground floor of the
 * surface, the crossings into them, and the names given to areas. Anchors that move within those areas only need redrawing.
 */
export function layoutKey(overlay: FeatureOverlay | undefined, classify: (point: WorldPoint) => string) {
  if (!overlay) return "";
  const areas = new Set(overlay.anchors.flatMap(featurePoints).map(point => {
    const region = classify(point);
    return region === "main-world" && point.plane === 0 ? "" : `${region}/${point.plane}`;
  }).filter(Boolean));
  // An area is placed beside the crossing that enters it, so a different crossing lays out again.
  const crossings = edgeLinks(overlay.anchors, classify).map(link => featurePoints({ kind: "edge", key: "", from: link.source.from, to: link.source.to, tone: "object" }));
  return JSON.stringify([[...areas].sort(), crossings, overlay.names || []]);
}

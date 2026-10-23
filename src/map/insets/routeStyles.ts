import type Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type Point from "ol/geom/Point";
import PointGeometry from "ol/geom/Point";
import type LineString from "ol/geom/LineString";
import LineStringGeometry from "ol/geom/LineString";
import type Polygon from "ol/geom/Polygon";
import Overlay from "ol/Overlay";
import { Circle, Fill, RegularShape, Stroke, Style } from "ol/style";
import type { Coordinate } from "ol/coordinate";
import { routeLineAppearance, routeMarkers, type RouteLineKind } from "../routeAppearance";

const ink = "#141914";
const lines = new Map<string, Style>();
const dots = new Map<string, Style>();
for (const kind of ["walk", "transport", "teleport"] as const) for (const selected of [false, true]) {
  const look = routeLineAppearance(kind, selected);
  const key = `${kind}/${selected}`;
  lines.set(key, new Style({ stroke: new Stroke({ color: look.color, width: look.weight,
    lineCap: look.lineCap, lineJoin: look.lineJoin, lineDash: look.dashArray?.split(" ").map(Number) }) }));
  dots.set(key, new Style({ image: new Circle({ radius: look.weight / 2, fill: new Fill({ color: look.color }) }) }));
}

/** Map units per game tile (see `worldToMap`). */
const TILE_UNITS = 32;
/** Endpoints outline their game tile, but never smaller than this on screen. */
export const MIN_ENDPOINT_PX = 10;
/** The A/B tag beside an endpoint's tile. */
const TAG_PX = 15, TAG_GAP = 3;

/** An endpoint's tile size on screen at a view resolution. */
export function endpointPixels(resolution: number) {
  return Math.max(MIN_ENDPOINT_PX, Math.round(TILE_UNITS / resolution));
}

const endpointHits = new Map<number, Style[]>();
/** Invisible hit areas for dragging an endpoint: its tile, with some slack, and its tag. */
function endpointHit(resolution: number): Style[] {
  const size = endpointPixels(resolution);
  let styles = endpointHits.get(size);
  if (!styles) {
    const fill = new Fill({ color: "transparent" });
    const tagOffset = size / 2 + TAG_GAP + TAG_PX / 2;
    styles = [
      new Style({ image: new RegularShape({ points: 4, radius: (size / 2 + 4) * Math.SQRT2, angle: Math.PI / 4, fill }), zIndex: 1 }),
      new Style({ image: new RegularShape({ points: 4, radius: TAG_PX / Math.SQRT2 + 2, angle: Math.PI / 4, fill,
        displacement: [tagOffset, tagOffset] }), zIndex: 1 }),
    ];
    endpointHits.set(size, styles);
  }
  return styles;
}

/** A transport row under review: added, removed, or edited. */
export type ReviewTone = "added" | "removed" | "changed";
const TONES: Record<ReviewTone, string> = { added: "#5ee08a", removed: "#ff6b6b", changed: "#ffc44d" };

/** Screen pixels a review edge is moved to its right, so a row and its way back sit side by side. */
const LANE_PX = 5;
/**
 * A review row's edge: a line in its tone, dashed once removed, with an arrowhead at the destination.
 * Edges are drawn a little to the right of their direction, like lanes of a road, so a two-way pair
 * shows as two arrows rather than one line.
 */
function reviewLineStyle(feature: FeatureLike, selected: boolean, resolution: number): Style[] {
  const tone = feature.get("tone") as ReviewTone, color = TONES[tone];
  const coordinates = (feature.getGeometry() as LineString).getCoordinates?.();
  if (!coordinates || coordinates.length < 2) return [];
  const [x1, y1] = coordinates[0], [x2, y2] = coordinates.at(-1)!;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (!length) return [];
  const shift = LANE_PX * resolution, nx = (y2 - y1) / length * shift, ny = -(x2 - x1) / length * shift;
  // Stop short of the tile centre so the arrowhead sits on the destination tile's edge.
  const back = Math.min(length / 3, 12), tx = x2 - (x2 - x1) / length * back + nx, ty = y2 - (y2 - y1) / length * back + ny;
  const lane = new LineStringGeometry(coordinates.map(([x, y]) => [x + nx, y + ny]));
  return [
    new Style({ geometry: lane, stroke: new Stroke({ color: ink, width: selected ? 7 : 5 }) }),
    new Style({ geometry: lane, stroke: new Stroke({ color, width: selected ? 4 : 2.5, lineDash: tone === "removed" ? [6, 6] : undefined }) }),
    new Style({ geometry: new PointGeometry([tx, ty]), image: new RegularShape({
      points: 3, radius: selected ? 8 : 6, rotation: Math.PI / 2 - Math.atan2(y2 - y1, x2 - x1), rotateWithView: true,
      fill: new Fill({ color }), stroke: new Stroke({ color: ink, width: 1.5 }) }) }),
  ];
}

/** Below this many screen pixels a tile, review marks are drawn as fixed-size squares instead. */
const MARK_MIN_PX = 12;
const markStyles = new Map<string, Style>();
/**
 * A review row's tiles: the origin outlined, the destination filled, in the row's tone. Zoomed out
 * they keep a readable size, centred on their tile.
 */
export function reviewMarkStyle(feature: FeatureLike, resolution: number): Style {
  const tone = feature.get("tone") as ReviewTone, role = feature.get("role") as string;
  const small = TILE_UNITS / resolution < MARK_MIN_PX, key = `${tone}/${role}/${small}`;
  let style = markStyles.get(key);
  if (!style) {
    const color = TONES[tone];
    const stroke = role === "origin" ? new Stroke({ color, width: 3 }) : new Stroke({ color: ink, width: 1.5 });
    const fill = new Fill({ color: role === "origin" ? "rgba(0,0,0,0)" : `${color}b3` });
    style = small
      ? new Style({ geometry: mark => (mark.getGeometry() as Polygon).getInteriorPoint(),
        image: new RegularShape({ points: 4, radius: MARK_MIN_PX / Math.SQRT2, angle: Math.PI / 4, stroke, fill }) })
      : new Style({ stroke, fill });
    markStyles.set(key, style);
  }
  return style;
}

const collisionLooks: Record<string, Style> = {
  blocked: new Style({ fill: new Fill({ color: "rgba(255, 90, 90, 0.28)" }) }),
  wall: new Style({ stroke: new Stroke({ color: "#ff8f6b", width: 3, lineCap: "butt" }) }),
  edge: new Style({ stroke: new Stroke({ color: "rgba(255, 143, 107, 0.6)", width: 1.5, lineCap: "butt" }) }),
};
/** The pathfinder's collision: blocked tiles shaded, walls and doors heavy, other closed edges thin. */
export function collisionStyle(feature: FeatureLike): Style {
  return collisionLooks[feature.get("kind") as string];
}

export function routeFeatureStyle(feature: FeatureLike, selectedSegment?: number, resolution = 1): Style | Style[] {
  const role = String(feature.get("role"));
  if (feature.get("tone") && feature.getGeometry()?.getType() === "LineString") {
    return reviewLineStyle(feature, selectedSegment !== undefined && feature.get("segmentIndex") === selectedSegment, resolution);
  }
  if (role === "start" || role === "destination" || role === "bank" || role === "landing") return endpointHit(resolution);
  const selected = selectedSegment !== undefined && feature.get("segmentIndex") === selectedSegment;
  const key = `${role as RouteLineKind}/${selected}`;
  return (feature.getGeometry()?.getType() === "Point" ? dots : lines).get(key)!;
}

/**
 * Keep a marker attached to its geometry through both kinds of drag. Endpoints outline their game
 * tile (sized by the map's `--endpoint-px`) with an A/B tag beside it; `snap` moves the marker to
 * the tile under a dragged point.
 */
export function routeMarkerOverlay(feature: Feature<Point>, kind: keyof typeof routeMarkers | "landing", title: string,
  snap: (coordinate: Coordinate) => Coordinate = coordinate => coordinate) {
  // Teleport landings and bank stops are marked like endpoints, in their own colour.
  const label = document.createElement("span");
  label.textContent = kind === "landing" ? "T" : kind === "bank" ? "$" : routeMarkers[kind].label;
  label.className = "inset-endpoint-tag";
  const element = document.createElement("div");
  element.title = title;
  element.setAttribute("aria-label", title);
  element.className = `inset-endpoint ${kind}`;
  const tile = document.createElement("i"); tile.className = "inset-endpoint-tile";
  element.append(tile, label);
  const overlay = new Overlay({ element, positioning: "center-center", stopEvent: false });
  const update = () => overlay.setPosition(snap(feature.getGeometry()!.getCoordinates()));
  feature.on("change", update); update();
  return { overlay, dispose: () => feature.un("change", update) };
}

const doorLooks = [false, true].flatMap(up => [false, true].map(open => [
  new Style({ image: new RegularShape({ points: 4, radius: 8, angle: Math.PI / 4,
    fill: new Fill({ color: open ? "#ffae47" : ink }), stroke: new Stroke({ color: open ? ink : "#f7f1dc", width: 1.5 }) }) }),
  new Style({ image: new RegularShape({ points: 3, radius: 3.5, rotation: up ? 0 : Math.PI, fill: new Fill({ color: open ? ink : "#f7f1dc" }) }) }),
]));
/**
 * A small square with a down arrow for an entrance to a named area, or an up arrow for a building's
 * upper floors; filled once they are shown.
 */
export function doorStyle(feature: FeatureLike): Style[] {
  return doorLooks[(feature.get("floors") ? 2 : 0) + (feature.get("open") ? 1 : 0)];
}

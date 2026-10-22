import type Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type Point from "ol/geom/Point";
import Overlay from "ol/Overlay";
import { Circle, Fill, RegularShape, Stroke, Style } from "ol/style";
import type { Coordinate } from "ol/coordinate";
import { routeLineAppearance, routeMarkers, type RouteLineKind } from "../routeAppearance";

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

export function routeFeatureStyle(feature: FeatureLike, selectedSegment?: number, resolution = 1): Style | Style[] {
  const role = String(feature.get("role"));
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

const ink = "#141914";
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

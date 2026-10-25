import type Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type Point from "ol/geom/Point";
import PointGeometry from "ol/geom/Point";
import type LineString from "ol/geom/LineString";
import LineStringGeometry from "ol/geom/LineString";
import type Polygon from "ol/geom/Polygon";
import Overlay from "ol/Overlay";
import { Circle, Fill, RegularShape, Stroke, Style, Text } from "ol/style";
import type { Coordinate } from "ol/coordinate";
import { routeLineAppearance, routeMarkers, type RouteLineKind } from "../routeAppearance";
import type { FeatureTone } from "./features";

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

/** Feature colours: review rows by change, transports by kind. */
export const TONES: Record<FeatureTone, string> = { added: "#5ee08a", removed: "#ff6b6b", changed: "#ffc44d",
  object: "#c8ff3c", journey: "#6fc3ff", teleport: "#c79bff", bank: "#ffcc33",
  area: "#ffae47", candidate: "#ff7ad9", suspect: "#ff6b6b", component: "#7ee0d0", evidence: "#ffe066", entrance: "#f7f1dc", draft: "#5ee08a" };

/** A tile's size on screen, at a view resolution. */
const tilePixels = (resolution: number) => TILE_UNITS / resolution;
/** `tiles` of a tile on screen, kept between `min` and `max` pixels so it stays legible but never outgrows the tile. */
const scaled = (resolution: number, tiles: number, min: number, max: number) => Math.min(max, Math.max(min, tilePixels(resolution) * tiles));

/**
 * An edge: a line in its tone, dashed when asked (a removed row), with an arrowhead at the destination.
 * Edges are drawn a little to the right of their direction, like lanes of a road, so a two-way pair
 * shows as two arrows rather than one line. Widths follow the map's scale, so the line belongs to the
 * tiles it joins. A hop between neighbouring tiles is a bar across the edge they share instead.
 */
function edgeStyle(feature: FeatureLike, selected: boolean, resolution: number): Style[] {
  const color = TONES[feature.get("tone") as FeatureTone];
  const coordinates = (feature.getGeometry() as LineString).getCoordinates?.();
  if (!coordinates || coordinates.length < 2) return [];
  const [x1, y1] = coordinates[0], [x2, y2] = coordinates.at(-1)!;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (!length) return [];
  if (feature.get("hop")) return hopStyle(feature, color, selected, resolution, [x1, y1], [x2, y2], length);
  if (feature.get("spoke")) return [
    new Style({ stroke: new Stroke({ color: "rgba(20,25,20,.55)", width: scaled(resolution, 0.08, 1.5, 2.5) + 2 + (selected ? 1 : 0) }) }),
    new Style({ stroke: new Stroke({ color: selected ? color : `${color}cc`, width: scaled(resolution, 0.08, 1.5, 2.5) + (selected ? 1 : 0) }) })];
  const width = scaled(resolution, 0.16, 1.5, 5) + (selected ? 1.5 : 0);
  const shift = scaled(resolution, 0.16, 1.5, 5) * resolution, nx = (y2 - y1) / length * shift, ny = -(x2 - x1) / length * shift;
  // Stop short of the tile centre so the arrowhead sits on the destination tile's edge.
  const back = Math.min(length / 3, 12), tx = x2 - (x2 - x1) / length * back + nx, ty = y2 - (y2 - y1) / length * back + ny;
  const lane = new LineStringGeometry(coordinates.map(([x, y]) => [x + nx, y + ny]));
  return [
    new Style({ geometry: lane, stroke: new Stroke({ color: ink, width: width + 2.5 }) }),
    new Style({ geometry: lane, stroke: new Stroke({ color, width, lineDash: feature.get("dashed") ? [6, 6] : undefined }) }),
    new Style({ geometry: new PointGeometry([tx, ty]), image: new RegularShape({
      points: 3, radius: scaled(resolution, 0.32, 3.5, 10) + (selected ? 2 : 0), rotation: Math.PI / 2 - Math.atan2(y2 - y1, x2 - x1), rotateWithView: true,
      fill: new Fill({ color }), stroke: new Stroke({ color: ink, width: 1.5 }) }) }),
  ];
}

/** A hop (a door, a stile): a bar most of a tile long over the edge between its tiles, both ways alike. */
function hopStyle(feature: FeatureLike, color: string, selected: boolean, resolution: number, [x1, y1]: Coordinate, [x2, y2]: Coordinate, length: number): Style[] {
  const half = TILE_UNITS * 0.4, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ux = -(y2 - y1) / length * half, uy = (x2 - x1) / length * half;
  const bar = new LineStringGeometry([[mx - ux, my - uy], [mx + ux, my + uy]]);
  const width = scaled(resolution, 0.22, 2, 7);
  return [
    new Style({ geometry: bar, stroke: new Stroke({ color: selected ? "#ffffff" : ink, width: width + (selected ? 4 : 2.5), lineCap: "butt" }) }),
    new Style({ geometry: bar, stroke: new Stroke({ color, width, lineCap: "butt", lineDash: feature.get("dashed") ? [4, 3] : undefined }) }),
  ];
}

/**
 * A network's hub: a node in its tone ringed dark and light, with its name under it, big enough to
 * find from across the world. A station node (zoomed out, where its tiles are specks) is a small dot
 * of the same, gone once the tiles themselves can be seen.
 */
function hubStyle(feature: FeatureLike, selected: boolean, resolution: number): Style | Style[] {
  const color = TONES[feature.get("tone") as FeatureTone];
  if (feature.get("station")) {
    if (32 / resolution >= 6) return [];
    return new Style({ image: new Circle({ radius: selected ? 5 : 3.5, fill: new Fill({ color }), stroke: new Stroke({ color: selected ? "#ffffff" : ink, width: 1.5 }) }), zIndex: 2 });
  }
  const radius = scaled(resolution, 0.6, 9, 14);
  return [
    new Style({ image: new Circle({ radius: radius + 2.5, fill: new Fill({ color: selected ? "#ffffff" : ink }) }), zIndex: 3 }),
    new Style({ image: new Circle({ radius, fill: new Fill({ color }), stroke: new Stroke({ color: "#f7f1dc", width: 2 }) }), zIndex: 3,
      text: new Text({ text: String(feature.get("label")), font: "bold 13px ui-monospace, monospace", offsetY: radius + 12, overflow: true,
        fill: new Fill({ color: selected ? "#ffffff" : color }), stroke: new Stroke({ color: ink, width: 4 }) }) }),
  ];
}

const markStyles = new Map<string, Style[]>();
/**
 * A point feature's tile, always the tile itself so it scales with the map, on a dark casing that
 * keeps it apart from any terrain: an origin a thick ring in its tone over a light wash of it, a
 * destination solid in its tone with a dark dot at its heart, where things arrive. Hovered, the
 * casing turns light; selected, it gains a white halo.
 */
export function markStyle(feature: FeatureLike, resolution: number, selected = false, hovered = false): Style[] {
  const tone = feature.get("tone") as FeatureTone, role = feature.get("role") as string;
  const width = Math.round(scaled(resolution, 0.13, 1.5, 4.5) * 2) / 2, state = selected ? "selected" : hovered ? "hovered" : "plain";
  const dashed = !!feature.get("dashed"), lineDash = dashed ? [3, 3] : undefined;
  const key = `${tone}/${role}/${width}/${state}/${dashed}`;
  let styles = markStyles.get(key);
  if (!styles) {
    const color = TONES[tone], casing = width + 3;
    const centre = (mark: FeatureLike) => (mark.getGeometry() as Polygon).getInteriorPoint();
    styles = [
      ...(selected ? [new Style({ stroke: new Stroke({ color: "#ffffff", width: casing + 4, lineDash }), zIndex: 1 })] : []),
      new Style({ stroke: new Stroke({ color: hovered && !selected ? "#f7f1dc" : ink, width: casing, lineDash }), zIndex: 1 }),
      role === "origin"
        ? new Style({ stroke: new Stroke({ color, width, lineDash }), fill: new Fill({ color: `${color}4d` }), zIndex: 1 })
        : new Style({ fill: new Fill({ color }), stroke: new Stroke({ color, width: Math.max(1, width - 1), lineDash }), zIndex: 1 }),
      ...(role === "origin" ? [] : [new Style({ geometry: centre, zIndex: 1,
        image: new RegularShape({ points: 4, radius: scaled(resolution, 0.17, 1.5, 5.5), angle: Math.PI / 4, fill: new Fill({ color: ink }) }) })]),
    ];
    markStyles.set(key, styles);
  }
  return styles;
}

/** A region: its rectangle tinted, with its label over it. */
function regionStyle(feature: FeatureLike, selected: boolean): Style {
  const color = TONES[feature.get("tone") as FeatureTone];
  return new Style({
    fill: new Fill({ color: `${color}33` }), stroke: new Stroke({ color: selected ? "#ffffff" : `${color}cc`, width: selected ? 2.5 : 1.5,
      lineDash: feature.get("dashed") ? [6, 4] : undefined }),
    text: feature.get("label") ? new Text({ text: String(feature.get("label")), font: "bold 12px ui-monospace, monospace", overflow: true,
      fill: new Fill({ color: "#ffffff" }), stroke: new Stroke({ color: ink, width: 3 }) }) : undefined,
  });
}

const maskLooks = new Map<string, Style>();
/** A region's exact terrain: lightly tinted, its outline in its tone; heavier when `strong` (the selected region). */
export function maskStyle(feature: FeatureLike): Style {
  const tone = feature.get("tone") as FeatureTone, strong = !!feature.get("strong"), part = feature.get("part");
  const key = `${tone}/${strong}/${part}`;
  let style = maskLooks.get(key);
  if (!style) {
    const color = TONES[tone];
    style = part === "fill" ? new Style({ fill: new Fill({ color: `${color}${strong ? "2e" : "14"}` }) })
      : new Style({ stroke: new Stroke({ color: strong ? color : `${color}99`, width: strong ? 4 : 2 }) });
    maskLooks.set(key, style);
  }
  return style;
}

/** An overlay feature (see features.ts), by its kind; `selected` is the selected item's key, `hovered` the one under the pointer. */
export function featureStyle(feature: FeatureLike, selected: string | undefined, resolution: number, hovered?: string): Style | Style[] {
  const isSelected = selected !== undefined && feature.get("key") === selected;
  const isHovered = hovered !== undefined && feature.get("key") === hovered;
  const kind = feature.get("kind");
  if (kind === "edge") return edgeStyle(feature, isSelected || isHovered, resolution);
  if (kind === "point") return markStyle(feature, resolution, isSelected, isHovered);
  if (kind === "hub") return hubStyle(feature, isSelected || isHovered, resolution);
  return regionStyle(feature, isSelected || isHovered);
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

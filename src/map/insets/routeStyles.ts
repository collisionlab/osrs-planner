import type Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type Point from "ol/geom/Point";
import Overlay from "ol/Overlay";
import { Circle, Fill, RegularShape, Stroke, Style } from "ol/style";
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
const markerHits = Object.fromEntries(Object.entries(routeMarkers).map(([kind, marker]) => [kind,
  new Style({ image: new RegularShape({ points: 4, radius: marker.size / Math.SQRT2, angle: Math.PI / 4,
    fill: new Fill({ color: "transparent" }) }), zIndex: 1 }),
]));

export function routeFeatureStyle(feature: FeatureLike, selectedSegment?: number): Style {
  const role = String(feature.get("role"));
  if (role in markerHits) return markerHits[role];
  const selected = selectedSegment !== undefined && feature.get("segmentIndex") === selectedSegment;
  const key = `${role as RouteLineKind}/${selected}`;
  return (feature.getGeometry()?.getType() === "Point" ? dots : lines).get(key)!;
}

/** Keep the existing CSS marker attached to its geometry through both kinds of drag. */
export function routeMarkerOverlay(feature: Feature<Point>, kind: keyof typeof routeMarkers, title: string) {
  const look = routeMarkers[kind];
  const element = document.createElement("div");
  element.className = look.className;
  element.style.width = element.style.height = `${look.size}px`;
  element.title = title;
  element.setAttribute("aria-label", title);
  const label = document.createElement("span"); label.textContent = look.label; element.append(label);
  const overlay = new Overlay({ element, positioning: "center-center", stopEvent: false });
  const update = () => overlay.setPosition(feature.getGeometry()!.getCoordinates());
  feature.on("change", update); update();
  return { overlay, dispose: () => feature.un("change", update) };
}

import Feature from "ol/Feature";
import OLMap from "ol/Map";
import Overlay from "ol/Overlay";
import View from "ol/View";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import Point from "ol/geom/Point";
import Translate from "ol/interaction/Translate";
import { Stroke, Style } from "ol/style";
import { createEmpty, extend, isEmpty } from "ol/extent";
import type { Coordinate } from "ol/coordinate";
import type { OsrsMapProps } from "../OsrsMap";
import type { WorldPoint } from "../../domain/contracts";
import type { InsetArea, InsetAssets, InsetDoor } from "./assets";
import { contains } from "./geometry";
import { catalogueClassifier, isDetachedUpperFloor, withRouteFloors } from "./preview";
import { decomposeRoute, type RouteTransition } from "./routeSections";
import { layoutRegions, regionExtent, type Placement } from "./layout";
import { worldToMap, mapToWorld, osrsProjection, resolutions, MAX_ZOOM, MIN_ZOOM } from "./projection";
import { surfaceLayer } from "./tactical";
import { regionTerrain, type TerrainTiles } from "./terrain";
import { PastedTerrainSource } from "./PastedTerrainSource";
import { RegionFeatures } from "./RegionFeatures";
import { doorStyle, endpointPixels, routeFeatureStyle, routeMarkerOverlay } from "./routeStyles";
import { regionContour } from "./contour";

export function segmentPoints(segment: NonNullable<OsrsMapProps["route"]>["segments"][number]): WorldPoint[] {
  return segment.kind === "walk" ? segment.path : segment.kind === "bank" ? [segment.location] : [segment.from, segment.to];
}

/** Hit-test topmost translated masks before converting display coordinates back to world tiles. */
export function pickWorld(coordinate: Coordinate, assets: InsetAssets, placements: Map<string, Placement>, fallbackPlane = 0): WorldPoint {
  for (const [id, placement] of [...placements].reverse()) {
    const region = assets.catalogue.regions.find(r => r.id === id);
    if (!region) continue;
    const point = mapToWorld([coordinate[0] - placement.offset[0], coordinate[1] - placement.offset[1]], region.plane);
    if (contains(region, point.x, point.y, point.plane)) return point;
  }
  return mapToWorld(coordinate, fallbackPlane);
}

export interface AreaOptions {
  /** Named areas to show even though the route doesn't reach them. */
  shown?: InsetArea[];
  /** Surface entrances to mark when zoomed in; clicking one calls `onDoor`. */
  doors?: InsetDoor[];
  onDoor?(door: InsetDoor): void;
}

export function createComposition(target: HTMLElement, releaseAssets: InsetAssets, props: OsrsMapProps,
  callbacks: () => OsrsMapProps, layer: { url: string; attribution: string; maxNativeZoom?: number },
  terrainTiles: TerrainTiles, report: (message: string) => void, initialView?: { center: Coordinate; resolution: number },
  areas: AreaOptions = {}) {
  const { route, start, destination } = props;
  const assets = route ? { ...releaseAssets, catalogue: withRouteFloors(releaseAssets.catalogue, route.segments.flatMap(segmentPoints)) }
    : releaseAssets;
  const classify = catalogueClassifier(assets.catalogue, { detachUpperFloors: true });
  const points = [start?.coordinate, destination?.coordinate, ...(route?.segments.flatMap(segmentPoints) || [])]
    .filter((point): point is WorldPoint => !!point);
  const touched = new Set(points.map(classify));
  // A shown area keeps its entrance placement once an endpoint is put in it; a route that really
  // crosses into it is laid out first, so its own crossing wins.
  const shown = areas.shown || [];
  const shapes = assets.catalogue.regions.filter(region => touched.has(region.id) || shown.some(area => area.regionId === region.id));
  const decomposed = route ? decomposeRoute(route, classify) : { sections: [], transitions: [] };
  const surfacePoints = points.filter(point => classify(point) === "main-world").map(worldToMap);
  // A shown area is entered the way its anchors say, as if the route crossed there.
  const entrances: RouteTransition[] = shown.filter(area => area.entrance).map(area => ({
    segmentIndex: -1, kind: "region", fromRegion: classify(area.entrance!.surface), toRegion: area.regionId,
    source: { kind: "transport", name: area.name, transportId: `entrance:${area.regionId}`, from: area.entrance!.surface,
      to: area.entrance!.inside, costTicks: 0, requirements: [] },
  }));
  const placements = layoutRegions(shapes, [...decomposed.transitions.filter(t => t.kind === "region"), ...entrances], surfacePoints, 40 * 8,
    new Set(shapes.filter(isDetachedUpperFloor).map(shape => shape.id)));
  // Unknown coordinates remain visible in their original world position.
  if (touched.has("unmapped") && !placements.has("unmapped")) placements.set("unmapped", { offset: [0, 0], anchored: false });
  const projected = (point: WorldPoint) => {
    const original = worldToMap(point), offset = placements.get(classify(point))?.offset || [0, 0];
    return [original[0] + offset[0], original[1] + offset[1]];
  };
  const view = new View({ projection: osrsProjection, resolutions, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
    enableRotation: false, center: worldToMap({ x: 3222, y: 3218, plane: 0 }), zoom: 7 });
  const base = surfaceLayer(layer.url, layer.attribution, layer.maxNativeZoom ?? 11);
  const surfaceBounds = createEmpty();
  for (const [plane, x, y, width, height] of assets.catalogue.surfaceRects) {
    if (plane !== 0) continue;
    extend(surfaceBounds, [...worldToMap({ x: x - 0.5, y: y - 0.5, plane }),
      ...worldToMap({ x: x + width - 0.5, y: y + height - 0.5, plane })]);
  }
  if (!isEmpty(surfaceBounds)) base.setExtent(surfaceBounds);
  const map = new OLMap({ target, view, layers: [base] });
  let disposed = false;
  const cleanup: (() => void)[] = [];
  const owned = new RegionFeatures();
  const routeSource = new VectorSource();
  let selected: number | undefined;
  const routes = new VectorLayer({ source: routeSource, zIndex: 100, updateWhileInteracting: true, updateWhileAnimating: true,
    style: (feature, resolution) => routeFeatureStyle(feature, selected, resolution),
  });
  // A provisional route, drawn over the dimmed current one while an endpoint is dragged.
  const previewSource = new VectorSource();
  map.addLayer(new VectorLayer({ source: previewSource, zIndex: 101, updateWhileInteracting: true, updateWhileAnimating: true,
    style: (feature, resolution) => routeFeatureStyle(feature, undefined, resolution) }));
  const sizeEndpoints = () => target.style.setProperty("--endpoint-px", `${endpointPixels(view.getResolution() ?? 1)}px`);
  view.on("change:resolution", sizeEndpoints); sizeEndpoints();
  // Filled in once every region is placed; until then markers sit where they were put.
  let hitPlacements: Map<string, Placement> | undefined;
  const snap = (coordinate: Coordinate) => hitPlacements ? projected(pickWorld(coordinate, assets, hitPlacements)) : coordinate;
  map.addLayer(routes);
  const addPoint = (point: WorldPoint, role: string, segmentIndex?: number) => {
    const feature = new Feature(new Point(projected(point)));
    feature.setProperties({ role, segmentIndex, plane: point.plane });
    routeSource.addFeature(feature); owned.add(classify(point), feature);
    if (role === "start" || role === "destination" || role === "bank") {
      const title = role === "start" ? `Start: ${start?.name}` : role === "destination" ? `Destination: ${destination?.name}` : "Bank stop";
      const marker = routeMarkerOverlay(feature, role, title, role === "bank" ? undefined : snap);
      map.addOverlay(marker.overlay); cleanup.push(marker.dispose);
    }
  };
  for (const section of decomposed.sections) for (const step of section.steps) {
    if (step.kind === "bank") addPoint(step.source.location, "bank", step.segmentIndex);
    else if (step.kind === "walk" && step.path.length === 1) addPoint(step.path[0], "walk", step.segmentIndex);
    else {
      const coordinates = step.kind === "walk" ? step.path.map(projected) : [projected(step.source.from), projected(step.source.to)];
      const feature = new Feature(new LineString(coordinates));
      feature.setProperties({ role: step.kind, segmentIndex: step.segmentIndex });
      routeSource.addFeature(feature); owned.add(section.regionId, feature);
    }
  }
  for (const crossing of decomposed.transitions) {
    const feature = new Feature(new LineString([projected(crossing.source.from), projected(crossing.source.to)]));
    feature.setProperties({ role: crossing.source.kind,
      segmentIndex: crossing.segmentIndex });
    routeSource.addFeature(feature); owned.addLink(crossing.fromRegion, crossing.toRegion, feature.getGeometry()!);
  }
  if (start) addPoint(start.coordinate, "start");
  if (destination) addPoint(destination.coordinate, "destination");
  route?.segments.forEach((segment, segmentIndex) => {
    if (segment.kind !== "teleport") return;
    const feature = new Feature(new Point(projected(segment.to)));
    feature.setProperties({ role: "landing", segmentIndex });
    routeSource.addFeature(feature); owned.add(classify(segment.to), feature);
    const marker = routeMarkerOverlay(feature, "landing", `${segment.name}: arrival`);
    map.addOverlay(marker.overlay); cleanup.push(marker.dispose);
  });
  const contours = new VectorSource();
  map.addLayer(new VectorLayer({ source: contours, zIndex: 5, updateWhileInteracting: true, updateWhileAnimating: true,
    style: [new Style({ stroke: new Stroke({ color: "#c6b994", width: 8 }) }), new Style({ stroke: new Stroke({ color: "#262b25", width: 6 }) })] }));
  // Shown areas: a faint line from the surface entrance to where it leads, which follows inset drags.
  // An anchor that isn't a way in only places its area, so it gets no line.
  const entranceSource = new VectorSource();
  map.addLayer(new VectorLayer({ source: entranceSource, zIndex: 90, updateWhileInteracting: true, updateWhileAnimating: true,
    style: new Style({ stroke: new Stroke({ color: "#f7f1dc", width: 2, lineDash: [2, 6] }) }) }));
  for (const crossing of entrances.filter(entrance => shown.find(area => area.regionId === entrance.toRegion)?.entrance?.wayIn)) {
    const line = new LineString([projected(crossing.source.from), projected(crossing.source.to)]);
    entranceSource.addFeature(new Feature(line)); owned.addLink(crossing.fromRegion, crossing.toRegion, line);
  }
  const doorSource = new VectorSource();
  const doorLayer = new VectorLayer({ source: doorSource, zIndex: 95, maxResolution: 8.01, style: doorStyle });
  map.addLayer(doorLayer);
  const resets: (() => void)[] = [];
  let failures = 0;
  const warnings = touched.has("unmapped") ? ["Some route points have no inset terrain."] : [];
  if (shapes.some(r => !placements.get(r.id)?.anchored)) warnings.push("Some regions have no physical entrance on this route.");
  const status = () => report([...warnings, ...(failures ? [`${failures} terrain tiles unavailable.`] : [])].join(" "));
  status();
  // Inset labels, in drawing order (the route's own areas first). A label is hidden while its inset
  // is too small on screen to name, or where it would cover a label drawn before it.
  const labels: { element: HTMLElement; extent(): number[] }[] = [];
  const MIN_LABELLED_PX = 24;
  const declutter = () => {
    const shown: DOMRect[] = [];
    for (const label of labels) {
      const [x1, , x2] = label.extent();
      const a = map.getPixelFromCoordinate([x1, 0]), b = map.getPixelFromCoordinate([x2, 0]);
      const box = label.element.getBoundingClientRect();
      const hidden = !a || !b || Math.abs(b[0] - a[0]) < MIN_LABELLED_PX
        || shown.some(other => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom);
      label.element.style.visibility = hidden ? "hidden" : "";
      if (!hidden) shown.push(box);
    }
  };
  let declutterFrame = 0;
  map.on("postrender", () => { if (!declutterFrame) declutterFrame = requestAnimationFrame(() => { declutterFrame = 0; declutter(); }); });
  cleanup.push(() => cancelAnimationFrame(declutterFrame));
  const drawShape = (shape: typeof shapes[number], offset: Coordinate, draggable: boolean, index: number) => {
    let source: PastedTerrainSource;
    try {
      const terrain = regionTerrain(shape, terrainTiles, () => { if (!disposed) source.changed(); });
      source = new PastedTerrainSource(terrain.canvas, regionExtent(shape, offset));
      cleanup.push(() => { source.dispose(); terrain.dispose(); });
      void terrain.ready.then(count => { if (!disposed) { failures += count; status(); } });
    } catch (error) { warnings.push(String(error)); status(); return; }
    const imageLayer = new ImageLayer({ source, zIndex: 10 + index });
    map.addLayer(imageLayer);
    const outline = new Feature(new MultiLineString(regionContour(shape).map(line => line.map(([x, y]) => {
      const coordinate = worldToMap({ x: x - 0.5, y: y - 0.5, plane: shape.plane });
      return [coordinate[0] + offset[0], coordinate[1] + offset[1]];
    }))));
    if (draggable) { contours.addFeature(outline); owned.add(shape.id, outline); }
    if (!draggable) return;
    const placement = placements.get(shape.id)!;
    const initialOffset = [...offset];
    const label = document.createElement("button"); label.className = "inset-label"; label.type = "button";
    // Upper floors are small and come in stacks, so their plane is their whole label.
    const name = assets.labels[shape.id]?.name || (isDetachedUpperFloor(shape) ? "" : `Terrain at ${shape.bounds[0]}, ${shape.bounds[1]}`);
    label.textContent = name ? `${name} · Plane ${shape.plane}` : `Plane ${shape.plane}`;
    label.title = "Drag to move; press Enter or double-click to reset";
    const overlay = new Overlay({ element: label, positioning: "bottom-center", offset: [0, -8], stopEvent: true });
    map.addOverlay(overlay);
    labels.push({ element: label, extent: () => regionExtent(shape, placement.offset) });
    let rendered = [...offset], frame = 0;
    const update = () => {
      const dx = placement.offset[0] - rendered[0], dy = placement.offset[1] - rendered[1];
      owned.translate(shape.id, dx, dy); rendered = [...placement.offset];
      const bounds = regionExtent(shape, placement.offset); source.moveTo(bounds); imageLayer.setExtent(bounds);
      overlay.setPosition([(bounds[0] + bounds[2]) / 2, bounds[3]]);
    };
    const reset = () => { placement.offset = [...initialOffset]; update(); }; resets.push(reset); update();
    label.addEventListener("dblclick", reset);
    label.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reset(); } });
    const stopDrag = () => {
      if (frame) cancelAnimationFrame(frame); frame = 0;
      label.onpointermove = label.onpointerup = label.onpointercancel = null;
    };
    cleanup.push(stopDrag);
    label.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); label.setPointerCapture(event.pointerId);
      const origin = map.getCoordinateFromPixel(map.getEventPixel(event)), original = [...placement.offset];
      label.onpointermove = event => {
        const next = map.getCoordinateFromPixel(map.getEventPixel(event));
        placement.offset = [original[0] + next[0] - origin[0], original[1] + next[1] - origin[1]];
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
      };
      label.onpointerup = label.onpointercancel = () => { stopDrag(); update(); };
    });
  };
  shapes.forEach((shape, index) => drawShape(shape, placements.get(shape.id)!.offset, true, index));
  // Upper surface floors too large to detach stay at their real XY.
  const upper = assets.catalogue.regions.filter(shape => shape.plane > 0 && shape.classification === "main-world"
    && !isDetachedUpperFloor(shape) && points.some(point => point.plane === shape.plane && contains(shape, point.x, point.y, point.plane)));
  upper.forEach((shape, index) => drawShape(shape, [0, 0], false, shapes.length + index));
  const picked = new Map(shapes.map(shape => [shape.id, placements.get(shape.id)!]));
  upper.forEach(shape => picked.set(shape.id, { offset: [0, 0], anchored: true }));
  hitPlacements = picked;
  for (const door of areas.doors || []) {
    // Entrances under a pasted inset would look like part of it.
    const at = projected(door.point), under = pickWorld(at, assets, picked);
    if (classify(door.point) !== "main-world" || classify(under) !== "main-world") continue;
    const feature = new Feature(new Point(at));
    feature.setProperties({ door, floors: door.floors, open: door.regionIds.some(id => placements.has(id)),
      name: door.floors ? `${door.name || "Way up"} to plane ${Math.min(...door.regionIds.map(id => assets.catalogue.regions.find(r => r.id === id)?.plane ?? 1))}` : [...new Set(door.regionIds.map(id => assets.labels[id]?.name).filter(Boolean))].join(" / ") });
    doorSource.addFeature(feature);
  }
  const fitPoints = (coordinates: Coordinate[], maxZoom = 9) => {
    if (!coordinates.length) return;
    const extent = createEmpty(); coordinates.forEach(point => extend(extent, [...point, ...point]));
    if (!isEmpty(extent)) view.fit(extent, { padding: [70, 70, 70, 70], maxZoom });
  };
  const fit = () => {
    const extent = createEmpty();
    const routeExtent = routeSource.getExtent();
    if (routeExtent && !isEmpty(routeExtent)) extend(extent, routeExtent);
    shapes.forEach(shape => extend(extent, regionExtent(shape, placements.get(shape.id)!.offset)));
    if (!isEmpty(extent)) view.fit(extent, { padding: [70, 70, 70, 70], maxZoom: 9 });
  };
  let draggingEndpoint = false;
  let dragged: WorldPoint | undefined;
  const translate = new Translate({ layers: [routes], filter: feature => ["start", "destination"].includes(feature.get("role")) });
  map.addInteraction(translate);
  translate.on("translatestart", () => { draggingEndpoint = true; dragged = undefined; });
  translate.on("translating", event => {
    const point = pickWorld(event.coordinate, assets, picked);
    if (dragged && dragged.x === point.x && dragged.y === point.y && dragged.plane === point.plane) return;
    dragged = point;
    callbacks().onDragEndpoint?.(event.features.item(0).get("role"), point);
  });
  translate.on("translateend", event => {
    const feature = event.features.item(0);
    const point = pickWorld(event.coordinate, assets, picked);
    callbacks().onDragEndpoint?.(feature.get("role"), undefined);
    if (feature.get("role") === "start") callbacks().onMoveStart?.(point);
    else callbacks().onMoveDestination?.(point);
    // OL emits click events separately; singleclick must not turn a drag into a pick.
    queueMicrotask(() => { draggingEndpoint = false; });
  });
  map.on("singleclick", event => {
    if (draggingEndpoint) return;
    const door = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === doorLayer, hitTolerance: 4 });
    if (door) { areas.onDoor?.(door.get("door")); return; }
    const hit = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === routes, hitTolerance: 6 });
    if (hit) {
      const index = hit.get("segmentIndex");
      if (typeof index === "number") callbacks().onSelectSegment?.(index);
      return;
    }
    callbacks().onPick(pickWorld(event.coordinate, assets, picked, 0));
  });
  map.on("pointermove", event => {
    if (event.dragging) return;
    const door = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === doorLayer, hitTolerance: 4 });
    const hit = door || map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === routes, hitTolerance: 4 });
    target.style.cursor = hit ? "pointer" : "";
    target.title = door ? `${door.get("name")} — click to ${door.get("open") ? "hide" : "show"}` : "";
  });
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.updateSize()) : undefined;
  observer?.observe(target);
  if (initialView) { view.setCenter(initialView.center); view.setResolution(initialView.resolution); }
  else fit();
  return {
    fit,
    /** Show a whole region and where it is entered from. */
    fitRegion(regionId: string) {
      const shape = shapes.find(candidate => candidate.id === regionId), placement = placements.get(regionId);
      if (!shape || !placement) return;
      const extent = regionExtent(shape, placement.offset);
      const crossing = entrances.find(entrance => entrance.toRegion === regionId);
      if (crossing && shown.find(area => area.regionId === regionId)?.entrance?.wayIn) extend(extent, [...projected(crossing.source.from), ...projected(crossing.source.from)]);
      view.fit(extent, { padding: [90, 70, 70, 70], maxZoom: 9, duration: 250 });
    },
    /** Where the view is, to restore it in a rebuilt composition. */
    view: () => ({ center: view.getCenter()!, resolution: view.getResolution()! }),
    reset() { resets.forEach(reset => reset()); fit(); },
    /**
     * Draw a provisional route over the current one, with the current placements, or clear it.
     * Only steps whose points all lie on visible terrain are drawn: the layout is not rebuilt.
     */
    preview(next?: OsrsMapProps["route"]) {
      previewSource.clear();
      routes.setOpacity(next ? .35 : 1);
      if (!next) return;
      const visible = (point: WorldPoint) => placements.has(classify(point)) || picked.has(classify(point));
      next.segments.forEach((segment, segmentIndex) => {
        const coordinates = segmentPoints(segment);
        if (segment.kind === "bank" || !coordinates.every(visible)) return;
        const feature = new Feature(new LineString(coordinates.map(projected)));
        feature.setProperties({ role: segment.kind, segmentIndex });
        previewSource.addFeature(feature);
      });
    },
    /** Where a world tile is drawn, in pixels from the map's top left (for end-to-end tests). */
    pixel(point: WorldPoint) { return map.getPixelFromCoordinate(projected(point)); },
    select(index?: number) {
      selected = index; routes.changed();
      if (index !== undefined && route?.segments[index]) fitPoints(segmentPoints(route.segments[index]).map(projected), 10);
    },
    dispose() {
      disposed = true; observer?.disconnect(); cleanup.forEach(fn => fn());
      map.setTarget(undefined); map.dispose(); target.style.cursor = ""; target.title = "";
    },
  };
}

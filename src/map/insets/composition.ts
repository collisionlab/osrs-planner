import { inspectCoordinates } from "./inspectCoordinates";
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
import MultiPolygon from "ol/geom/MultiPolygon";
import Polygon from "ol/geom/Polygon";
import Translate from "ol/interaction/Translate";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import { Stroke, Style } from "ol/style";
import { createEmpty, extend, isEmpty } from "ol/extent";
import type { Coordinate } from "ol/coordinate";
import type { OsrsMapProps } from "../OsrsMap";
import type { WorldPoint } from "../../domain/contracts";
import { areaFloors, type InsetArea, type InsetAssets, type InsetDoor } from "./assets";
import { contains } from "./geometry";
import { catalogueClassifier, isDetachedUpperFloor, withRouteFloors } from "./preview";
import { decomposeRoute, type RouteTransition } from "./routeSections";
import { layoutRegions, regionExtent, type Placement } from "./layout";
import { worldToMap, mapToWorld, osrsProjection, resolutions, MAX_ZOOM, MIN_ZOOM } from "./projection";
import { surfaceLayer } from "./tactical";
import { regionTerrain, type TerrainTiles } from "./terrain";
import { PastedTerrainSource } from "./PastedTerrainSource";
import { RegionFeatures } from "./RegionFeatures";
import { collisionLayer } from "./collisionLayer";
import { doorStyle, endpointPixels, featureStyle, maskStyle, routeFeatureStyle, routeMarkerOverlay } from "./routeStyles";
import { regionContour } from "./contour";
import type { RoutingCrossing } from "./routing";
import { routingLayer } from "./routingLayer";
import { edgeLinks, featurePoints, featuresOf, keysHit, type FeatureOverlay, type MapFeature } from "./features";
import { visibleBoxes, type WorldBox } from "./projection";

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
  inspectCoordinates?: boolean;
  /** Named areas to show even though the route doesn't reach them. */
  shown?: InsetArea[];
  /** Surface entrances to mark when zoomed in; clicking one calls `onDoor`. */
  doors?: InsetDoor[];
  onDoor?(door: InsetDoor): void;
  /** The plane each inset shows, by the region it was laid out for; otherwise that region's own. */
  planes?: Record<string, number>;
  /** An inset's plane button was clicked. */
  onPlane?(regionId: string, plane: number): void;
  /** A routing separator was clicked. */
  onRoutingCrossing?(crossing: RoutingCrossing): void;
  /** Features drawn over the map besides the route (the workbench's tools; see features.ts). */
  overlay?: FeatureOverlay;
  /** Items under a click, by their features' keys, and the tile clicked. */
  onSelectFeatures?(keys: string[], point: WorldPoint): void;
  /** The world tiles in view, a box per area drawn, after each move. */
  onView?(boxes: WorldBox[], resolution: number): void;
  /** A network's hub (by its features' key) was dragged to a tile; given, hubs can be dragged. */
  onMoveHub?(key: string, point: WorldPoint): void;
}

/** The coarsest view anchors open at: 8 px a game tile, where collision is drawn. */
const ANCHOR_MAX_RESOLUTION = 4;
/** The fewest tiles across anchors are first shown with. */
const ANCHOR_FIT_TILES = 24;
/** Tiles of collision drawn around each anchor's tiles. */
export const COLLISION_RADIUS = 20;

export function createComposition(target: HTMLElement, releaseAssets: InsetAssets, props: OsrsMapProps,
  callbacks: () => OsrsMapProps, layer: { url: string; attribution: string; maxNativeZoom?: number },
  terrainTiles: TerrainTiles, report: (message: string) => void, initialView?: { center: Coordinate; resolution: number },
  areas: AreaOptions = {}) {
  const { route, start, destination } = props;
  const anchors = areas.overlay?.anchors || [];
  const anchorPoints = anchors.flatMap(featurePoints);
  const walked = [...(route?.segments.flatMap(segmentPoints) || []), ...anchorPoints];
  const assets = walked.length ? { ...releaseAssets, catalogue: withRouteFloors(releaseAssets.catalogue, walked) } : releaseAssets;
  const classify = catalogueClassifier(assets.catalogue, { detachUpperFloors: true });
  const regionById = new Map(assets.catalogue.regions.map(region => [region.id, region]));
  const points = [start?.coordinate, destination?.coordinate, ...walked].filter((point): point is WorldPoint => !!point);
  const touched = new Set(points.map(classify));
  // A shown area keeps its entrance placement once an endpoint is put in it; a route that really
  // crosses into it is laid out first, so its own crossing wins.
  // A tool's regions: those with an entrance are shown like the planner's areas, the rest in place.
  const overlayRegions = (areas.overlay?.regions || []).filter(region => regionById.has(region.regionId));
  const shown = [...areas.shown || [], ...overlayRegions.filter(region => region.entrance).map(({ regionId, entrance }) => ({
    regionId, entrance, name: assets.labels[regionId]?.name || regionId, tileCount: regionById.get(regionId)!.tileCount }))];
  const inPlace = new Set(overlayRegions.filter(region => !region.entrance && !region.aside).map(region => region.regionId));
  const aside = new Set(overlayRegions.filter(region => !region.entrance && region.aside).map(region => region.regionId));
  const shapes = assets.catalogue.regions.filter(region => touched.has(region.id) || inPlace.has(region.id) || aside.has(region.id) || shown.some(area => area.regionId === region.id));
  const decomposed = route ? decomposeRoute(route, classify) : { sections: [], transitions: [] };
  const surfacePoints = points.filter(point => classify(point) === "main-world").map(worldToMap);
  // A shown area is entered the way its anchors say, as if the route crossed there.
  const entrances: RouteTransition[] = shown.filter(area => area.entrance).map(area => ({
    segmentIndex: -1, kind: "region", fromRegion: classify(area.entrance!.surface), toRegion: area.regionId,
    source: { kind: "transport", name: area.name, transportId: `entrance:${area.regionId}`, from: area.entrance!.surface,
      to: area.entrance!.inside, costTicks: 0, requirements: [] },
  }));
  // Each inset draws its area's components on one plane together (see areaFloors). A route's own
  // inset switched to another plane hides the route there.
  const leads = new Set(shapes.map(shape => shape.id));
  const groups = shapes.map(lead => {
    const floors = areaFloors(assets, lead.id);
    const plane = areas.planes?.[lead.id] ?? lead.plane;
    const own = (ids: string[]) => ids.filter(id => id === lead.id || !leads.has(id)).map(id => regionById.get(id)!);
    const members = own(floors.get(plane) || [lead.id]);
    // Laid out by every floor's footprint, so switching planes leaves the inset where it is.
    const all = own([lead.id, ...[...floors.values()].flat()]);
    const bounds: typeof lead.bounds = [Math.min(...all.map(m => m.bounds[0])), Math.min(...all.map(m => m.bounds[1])),
      Math.max(...all.map(m => m.bounds[2])), Math.max(...all.map(m => m.bounds[3]))];
    return { lead, floors, plane, members, bounds };
  });
  const hidden = new Set(groups.filter(group => group.plane !== group.lead.plane).map(group => group.lead.id));
  const groupExtent = (group: typeof groups[number], offset: Coordinate) => regionExtent({ ...group.lead, bounds: group.bounds }, offset);
  const placements = layoutRegions(groups.map(group => ({ ...group.lead, bounds: group.bounds })),
    [...decomposed.transitions.filter(t => t.kind === "region"), ...entrances, ...edgeLinks(anchors, classify)], surfacePoints, 40 * 8,
    new Set(shapes.filter(isDetachedUpperFloor).map(shape => shape.id)), inPlace);
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
  // The target has a tabindex (for keys), which by default makes OpenLayers pan and wheel-zoom only
  // while the map has the focus: any click on a control beside it would stop the wheel working.
  const map = new OLMap({ target, view, layers: [base], interactions: defaultInteractions({ onFocusOnly: false }) });
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
    if (hidden.has(classify(point))) return;
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
    if (hidden.has(section.regionId)) continue;
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
    if (hidden.has(crossing.fromRegion) || hidden.has(crossing.toRegion)) continue;
    const feature = new Feature(new LineString([projected(crossing.source.from), projected(crossing.source.to)]));
    feature.setProperties({ role: crossing.source.kind, segmentIndex: crossing.segmentIndex });
    routeSource.addFeature(feature); owned.addLink(crossing.fromRegion, crossing.toRegion, feature.getGeometry()!);
  }
  if (start) addPoint(start.coordinate, "start");
  if (destination) addPoint(destination.coordinate, "destination");
  route?.segments.forEach((segment, segmentIndex) => {
    if (segment.kind !== "teleport" || hidden.has(classify(segment.to))) return;
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
  let overlay = areas.overlay;
  const featureSource = new VectorSource();
  const featureLayer = new VectorLayer({ source: featureSource, zIndex: 99, updateWhileInteracting: true, updateWhileAnimating: true,
    style: (feature, resolution) => featureStyle(feature, overlay?.selected, resolution, hovered) });
  map.addLayer(featureLayer);
  // The item under the pointer, drawn lit, and what its features say about it.
  let hovered: string | undefined;
  const tooltip = document.createElement("div");
  tooltip.className = "map-tooltip";
  tooltip.hidden = true;
  target.append(tooltip);
  cleanup.push(() => tooltip.remove());
  // Regions' exact terrain, tinted under the collision and the features; clicks pass through to the terrain.
  const maskSource = new VectorSource();
  map.addLayer(new VectorLayer({ source: maskSource, zIndex: 55, updateWhileInteracting: true, updateWhileAnimating: true, style: maskStyle }));
  // Drawn on its own canvas once every region is placed (see below).
  let collisionDrawing: ReturnType<typeof collisionLayer> | undefined;
  /** A tile's square on the map, drawn where its region is placed. */
  const tileRing = (point: WorldPoint, inset = 0) => {
    const [cx, cy] = projected(point), half = 16 - inset;
    return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]];
  };
  // Features of the overlay that aren't anchors are only drawn on terrain already shown (filled in once
  // every region is placed): an edge into an area nobody opened isn't drawn floating over the map.
  let drawable: (point: WorldPoint) => boolean = () => false;
  /** Draw (or redraw) the overlay's features and the collision around its anchors' tiles. */
  const drawOverlay = () => {
    featureSource.clear(); maskSource.clear();
    owned.remove(target => !!target.get("overlay"));
    if (!overlay) { collisionDrawing?.update(undefined); return; }
    const anchored = new Set<MapFeature>(overlay.anchors);
    const add = (source: VectorSource, region: string, feature: Feature) => {
      feature.set("overlay", true); source.addFeature(feature); owned.add(region, feature);
    };
    for (const item of overlay.features) {
      if (item.kind === "mask") {
        const region = regionById.get(item.regionId), placement = picked.get(item.regionId);
        if (!region || !placement || hidden.has(item.regionId)) continue;
        // Mask rectangles' tile edges, as the outline draws them, where the region is now.
        const corner = (x: number, y: number) => { const at = worldToMap({ x: x - 0.5, y: y - 0.5, plane: region.plane }); return [at[0] + placement.offset[0], at[1] + placement.offset[1]]; };
        const fill = new Feature(new MultiPolygon(region.mask.map(([x, y, w, h]) => [[corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h), corner(x, y)]])));
        const outline = new Feature(new MultiLineString(regionContour(region).map(line => line.map(([x, y]) => corner(x, y)))));
        fill.setProperties({ part: "fill", tone: item.tone, strong: item.strong }); outline.setProperties({ part: "outline", tone: item.tone, strong: item.strong });
        for (const feature of [fill, outline]) add(maskSource, item.regionId, feature);
        continue;
      }
      const ends = featurePoints(item);
      if (ends.some(point => hidden.has(classify(point))) || (!anchored.has(item) && !ends.every(drawable))) continue;
      let feature: Feature;
      if (item.kind === "edge") {
        feature = new Feature(new LineString([projected(item.from), projected(item.to)]));
        feature.setProperties({ dashed: item.dashed, hop: item.hop, spoke: item.spoke });
      } else if (item.kind === "hub") {
        feature = new Feature(new Point(projected(item.point)));
        feature.setProperties({ label: item.label, station: item.station });
      } else if (item.kind === "point") {
        feature = new Feature(new Polygon([tileRing(item.point, item.role === "origin" ? 2 : 0)]));
        feature.setProperties({ role: item.role, dashed: item.dashed });
      } else {
        const [x1, y1, x2, y2] = item.bounds;
        const [a, b] = [projected({ x: x1, y: y1, plane: item.plane }), projected({ x: x2, y: y2, plane: item.plane })];
        feature = new Feature(new Polygon([[[a[0] - 16, a[1] - 16], [b[0] + 16, a[1] - 16], [b[0] + 16, b[1] + 16], [a[0] - 16, b[1] + 16], [a[0] - 16, a[1] - 16]]]));
        feature.setProperties({ label: item.label, dashed: item.dashed });
      }
      feature.setProperties({ key: item.key, kind: item.kind, tone: item.tone, title: "title" in item ? item.title : undefined,
        tile: item.kind === "point" || item.kind === "hub" ? item.point : undefined });
      if (item.kind === "edge" && classify(item.from) !== classify(item.to)) {
        // An edge between two insets follows each end's inset.
        const line = feature.getGeometry() as LineString;
        line.set("overlay", true); feature.set("overlay", true); featureSource.addFeature(feature);
        owned.addLink(classify(item.from), classify(item.to), line);
      } else add(featureSource, classify(ends[0]), feature);
    }
    // Collision everywhere in view, or around the anchors' tiles.
    const points = overlay.anchors.filter(item => item.kind !== "region").flatMap(featurePoints);
    collisionDrawing?.update(overlay.collision && (overlay.collisionEverywhere || points.length)
      ? { collision: overlay.collision, around: overlay.collisionEverywhere ? undefined : { points, radius: COLLISION_RADIUS }, pyramid: overlay.collisionTiles }
      : undefined);
  };
  const doorSource = new VectorSource();
  const doorLayer = new VectorLayer({ source: doorSource, zIndex: 95, maxResolution: 8.01, style: doorStyle });
  map.addLayer(doorLayer);
  const resets: (() => void)[] = [];
  let failures = 0;
  const warnings = touched.has("unmapped") ? ["Some route points have no inset terrain."] : [];
  if (shapes.some(r => !placements.get(r.id)?.anchored && !aside.has(r.id))) warnings.push("Some regions have no physical entrance on this route.");
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
  let layers = 0;
  /** Paste a region's terrain at `offset`; returns how to move it, or nothing if it can't be drawn. */
  const drawTerrain = (shape: typeof shapes[number], offset: Coordinate, outlined: boolean) => {
    let source: PastedTerrainSource;
    try {
      const terrain = regionTerrain(shape, terrainTiles, () => { if (!disposed) source.changed(); });
      source = new PastedTerrainSource(terrain.canvas, regionExtent(shape, offset));
      cleanup.push(() => { source.dispose(); terrain.dispose(); });
      void terrain.ready.then(count => { if (!disposed) { failures += count; status(); } });
    } catch (error) { warnings.push(String(error)); status(); return undefined; }
    // Pasted in order, but always under the outlines, lines and markers (z-index 60 and up), however many there are.
    const imageLayer = new ImageLayer({ source, zIndex: 10 + layers++ / 1000 });
    map.addLayer(imageLayer);
    if (outlined) {
      const outline = new Feature(new MultiLineString(regionContour(shape).map(line => line.map(([x, y]) => {
        const coordinate = worldToMap({ x: x - 0.5, y: y - 0.5, plane: shape.plane });
        return [coordinate[0] + offset[0], coordinate[1] + offset[1]];
      }))));
      contours.addFeature(outline); owned.add(shape.id, outline);
    }
    return (next: Coordinate) => { const bounds = regionExtent(shape, next); source.moveTo(bounds); imageLayer.setExtent(bounds); };
  };
  const provisionalNames = new Map((overlay?.names || []).map(({ point, name }) => [classify(point), name] as const));
  /** An inset: its floor's terrain, and a label to drag it by with a button per plane its area has. */
  const drawGroup = (group: typeof groups[number]) => {
    const placement = placements.get(group.lead.id)!;
    const offset = placement.offset;
    const movers = group.members.map(member => drawTerrain(member, offset, true));
    if (movers.some(mover => !mover)) return;
    const initialOffset = [...offset];
    // Route features and the entrance line belong to the region laid out; outlines to each member.
    const owners = [...new Set([group.lead.id, ...group.members.map(member => member.id)])];
    const header = document.createElement("div"); header.className = "inset-header";
    const label = document.createElement("button"); label.className = "inset-label"; label.type = "button";
    // Upper floors are small and come in stacks, so their plane is their whole label.
    const naming = assets.labels[group.lead.id];
    const name = (naming?.status === "unresolved" ? provisionalNames.get(group.lead.id) : undefined) || naming?.name || (isDetachedUpperFloor(group.lead) ? "" : `Terrain at ${group.lead.bounds[0]}, ${group.lead.bounds[1]}`);
    label.textContent = name ? `${name} · Plane ${group.plane}` : `Plane ${group.plane}`;
    label.title = "Drag to move; press Enter or double-click to reset";
    header.append(label);
    if (group.floors.size > 1) {
      const planes = document.createElement("div"); planes.className = "inset-planes"; planes.setAttribute("role", "group");
      planes.setAttribute("aria-label", `${name || "Inset"}: plane`);
      for (const [plane, ids] of group.floors) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = String(plane);
        button.setAttribute("aria-pressed", String(plane === group.plane));
        const onRoute = ids.some(id => touched.has(id));
        if (onRoute) button.classList.add("on-route");
        button.title = `${plane === group.plane ? "Showing" : "Show"} plane ${plane}${onRoute ? " (on the route)" : ""}`;
        button.addEventListener("click", () => {
          if (plane === group.plane) return;
          // A floor the route already shows in its own inset is brought into view, not drawn twice.
          const own = ids.find(id => id !== group.lead.id && leads.has(id));
          if (own) fitRegion(own); else areas.onPlane?.(group.lead.id, plane);
        });
        planes.append(button);
      }
      header.append(planes);
    }
    const overlay = new Overlay({ element: header, positioning: "bottom-center", offset: [0, -8], stopEvent: true });
    map.addOverlay(overlay);
    labels.push({ element: header, extent: () => groupExtent(group, placement.offset) });
    let rendered = [...offset], frame = 0;
    const update = () => {
      const dx = placement.offset[0] - rendered[0], dy = placement.offset[1] - rendered[1];
      owners.forEach(id => owned.translate(id, dx, dy)); rendered = [...placement.offset];
      movers.forEach(mover => mover!(placement.offset));
      const bounds = groupExtent(group, placement.offset);
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
      label.onpointerup = label.onpointercancel = () => { stopDrag(); update(); reportView(); };
    });
  };
  groups.forEach(drawGroup);
  // Upper surface floors too large to detach stay at their real XY.
  const upper = assets.catalogue.regions.filter(shape => shape.plane > 0 && shape.classification === "main-world"
    && !isDetachedUpperFloor(shape) && points.some(point => point.plane === shape.plane && contains(shape, point.x, point.y, point.plane)));
  upper.forEach(shape => drawTerrain(shape, [0, 0], false));
  // What a click picks: each drawn floor, moved with its inset.
  const picked = new Map(groups.flatMap(group => group.members.map(member => [member.id, placements.get(group.lead.id)!] as const)));
  upper.forEach(shape => picked.set(shape.id, { offset: [0, 0], anchored: true }));
  hitPlacements = picked;
  // The routing overlay draws over the surface first, then each placed inset, as the terrain is drawn.
  // The surface, and each region where it is placed: what the canvas layers draw over.
  const drawnPlacements = () => [
    ...assets.catalogue.surfaceRects.filter(([plane]) => plane === 0).map(([plane, x, y, w, h]) => {
      const rect: [number, number, number, number] = [x, y, w, h];
      return { shape: { plane, bounds: [x, y, x + w, y + h] as [number, number, number, number], mask: [rect] }, offset: [0, 0] };
    }),
    ...[...picked].map(([id, placement]) => ({ shape: regionById.get(id)!, offset: placement.offset })),
  ];
  const routing = routingLayer(map, drawnPlacements);
  routing.update(overlay?.routing);
  cleanup.push(() => routing.dispose());
  collisionDrawing = collisionLayer(map, drawnPlacements);
  cleanup.push(() => collisionDrawing?.dispose());

  drawable = point => {
    const region = classify(point);
    if (region === "main-world") return point.plane === 0 || upper.some(shape => contains(shape, point.x, point.y, point.plane));
    return picked.has(region);
  };
  drawOverlay();
  // The world tiles in view: the surface's, and each drawn floor's where its inset is now.
  const surfaceWorld = createEmpty();
  for (const [plane, x, y, width, height] of assets.catalogue.surfaceRects) if (plane === 0) extend(surfaceWorld, [x, y, x + width - 1, y + height - 1]);
  const viewBoxes = (): WorldBox[] => {
    const extent = view.calculateExtent(map.getSize());
    const areasDrawn = [
      ...(isEmpty(surfaceWorld) ? [] : [{ plane: 0, bounds: surfaceWorld as [number, number, number, number], offset: [0, 0] }]),
      ...[...picked].map(([id, placement]) => { const shape = regionById.get(id) || upper.find(other => other.id === id)!;
        return { plane: shape.plane, bounds: shape.bounds, offset: placement.offset }; }),
    ];
    return visibleBoxes(extent, areasDrawn);
  };
  let viewTimer = 0;
  const reportView = () => {
    if (!areas.onView) return;
    clearTimeout(viewTimer);
    viewTimer = window.setTimeout(() => { if (!disposed && map.getSize()) areas.onView?.(viewBoxes(), view.getResolution() ?? 1); }, 120);
  };
  map.on("moveend", reportView);
  cleanup.push(() => clearTimeout(viewTimer));
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
    groups.forEach(group => extend(extent, groupExtent(group, placements.get(group.lead.id)!.offset)));
    if (!isEmpty(extent)) view.fit(extent, { padding: [70, 70, 70, 70], maxZoom: 9 });
  };
  /**
   * Fit the anchors closely enough to see single tiles and their collision (8 px a tile or more),
   * with at least {@link ANCHOR_FIT_TILES} tiles around them for context.
   */
  const fitAnchors = () => {
    const marks = (overlay?.anchors || []).filter(item => item.kind === "point").map(item => item as Extract<MapFeature, { kind: "point" }>)
      .filter(mark => !hidden.has(classify(mark.point)));
    if (!marks.length) { fit(); return; }
    const around = (points: WorldPoint[]) => {
      const extent = createEmpty();
      points.forEach(point => { const at = projected(point); extend(extent, [...at, ...at]); });
      const [x1, y1, x2, y2] = extent, half = ANCHOR_FIT_TILES * 16, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      return [Math.min(x1, cx - half), Math.min(y1, cy - half), Math.max(x2, cx + half), Math.max(y2, cy + half)];
    };
    const padding = [90, 70, 70, 70];
    view.fit(around(marks.map(mark => mark.point)), { padding, maxZoom: 10 });
    // Too far apart to see single tiles (an area placed beside a distant entrance): start at the
    // first origin's end; the row table moves to the other.
    if ((view.getResolution() ?? 1) > ANCHOR_MAX_RESOLUTION) {
      const first = marks.find(mark => mark.role === "origin") || marks[0];
      view.fit(around(marks.filter(mark => classify(mark.point) === classify(first.point)).map(mark => mark.point)), { padding, maxZoom: 10 });
    }
  };
  /** Show a whole inset and where it is entered from. */
  function fitRegion(regionId: string) {
    const group = groups.find(candidate => candidate.lead.id === regionId), placement = placements.get(regionId);
    if (!group || !placement) return;
    const extent = groupExtent(group, placement.offset);
    const crossing = entrances.find(entrance => entrance.toRegion === regionId);
    if (crossing && shown.find(area => area.regionId === regionId)?.entrance?.wayIn) extend(extent, [...projected(crossing.source.from), ...projected(crossing.source.from)]);
    view.fit(extent, { padding: [90, 70, 70, 70], maxZoom: 9, duration: 250 });
  }
  /** Show regions' real geometry where they are drawn (each drawn floor of them). */
  const fitRegions = (ids: string[]) => {
    const extent = createEmpty();
    for (const id of ids) {
      const region = regionById.get(id), placement = picked.get(id);
      if (region && placement) extend(extent, regionExtent(region, placement.offset));
    }
    if (!isEmpty(extent)) view.fit(extent, { padding: [90, 70, 70, 70], maxZoom: 9, duration: 250 });
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
  // A network's hub can be dragged out of the way; its spokes follow it, and the page is told where it was left.
  if (areas.onMoveHub) {
    const hubs = new Translate({ layers: [featureLayer], hitTolerance: 4, filter: feature => feature.get("kind") === "hub" && !feature.get("station") });
    map.addInteraction(hubs);
    const spokes = (key: string) => featureSource.getFeatures().filter(feature => feature.get("spoke") && feature.get("key") === key);
    hubs.on("translatestart", () => { draggingEndpoint = true; });
    hubs.on("translating", event => {
      for (const spoke of spokes(event.features.item(0).get("key"))) {
        const line = spoke.getGeometry() as LineString;
        line.setCoordinates([line.getFirstCoordinate(), event.coordinate]);
      }
    });
    hubs.on("translateend", event => {
      areas.onMoveHub?.(event.features.item(0).get("key"), pickWorld(event.coordinate, assets, picked, 0));
      queueMicrotask(() => { draggingEndpoint = false; });
    });
  }
  map.on("singleclick", event => {
    if (draggingEndpoint) return;
    const door = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === doorLayer, hitTolerance: 4 });
    if (door) { areas.onDoor?.(door.get("door")); return; }
    const hit = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === routes, hitTolerance: 6 });
    if (hit && typeof hit.get("segmentIndex") === "number") { callbacks().onSelectSegment?.(hit.get("segmentIndex")); return; }
    const crossing = routing.crossing(event.coordinate, pickWorld(event.coordinate, assets, picked, 0));
    if (crossing && areas.onRoutingCrossing) {
      areas.onRoutingCrossing(crossing);
      return;
    }
    const items = keysHit(map.getFeaturesAtPixel(event.pixel, { layerFilter: candidate => candidate === featureLayer, hitTolerance: 6 })
      .map(feature => ({ key: feature.get("key") })));
    if (items.length && areas.onSelectFeatures) { areas.onSelectFeatures(items, pickWorld(event.coordinate, assets, picked, 0)); return; }
    callbacks().onPick(pickWorld(event.coordinate, assets, picked, 0));
  });
  map.on("pointermove", event => {
    if (event.dragging) return;
    const door = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === doorLayer, hitTolerance: 4 });
    const hit = door || map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: candidate => candidate === routes || (candidate === featureLayer && !!areas.onSelectFeatures), hitTolerance: 4 });
    const hub = !door && areas.onMoveHub && hit?.get("kind") === "hub" && !hit.get("station");
    target.style.cursor = hub ? "grab" : hit ? "pointer" : "";
    target.title = door ? `${door.get("name")} — click to ${door.get("open") ? "hide" : "show"}` : "";
    // Every overlay item under the pointer: the topmost lit, and each one's title (or its tile) listed.
    const under = door ? [] : map.getFeaturesAtPixel(event.pixel, { layerFilter: candidate => candidate === featureLayer, hitTolerance: 4 });
    const items = new Map<string, string>();
    for (const feature of under) {
      const key = feature.get("key") as string | undefined, tile = feature.get("tile") as WorldPoint | undefined;
      if (key === undefined || items.has(key)) continue;
      const title = (feature.get("title") as string | undefined) || (tile ? `${tile.x} ${tile.y} ${tile.plane}` : "");
      if (title || !items.size) items.set(key, title);
    }
    const next = items.keys().next().value;
    if (next !== hovered) { hovered = next; featureLayer.changed(); }
    const lines = [...items.values()].filter(Boolean);
    tooltip.hidden = !lines.length;
    if (lines.length) {
      tooltip.textContent = lines.length > 4 ? [...lines.slice(0, 3), `and ${lines.length - 3} more`].join("\n") : lines.join("\n");
      tooltip.style.left = `${event.pixel[0] + 14}px`;
      tooltip.style.top = `${event.pixel[1] + 14}px`;
    }
  });
  if (areas.inspectCoordinates) cleanup.push(inspectCoordinates(map, target, coordinate => pickWorld(coordinate, assets, picked, 0)));
  const leave = () => { tooltip.hidden = true; if (hovered !== undefined) { hovered = undefined; featureLayer.changed(); } };
  target.addEventListener("pointerleave", leave);
  cleanup.push(() => target.removeEventListener("pointerleave", leave));
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.updateSize()) : undefined;
  observer?.observe(target);
  if (initialView) { view.setCenter(initialView.center); view.setResolution(initialView.resolution); }
  else if (anchors.length) fitAnchors();
  else fit();
  reportView();
  return {
    fit,
    fitRegion,
    fitRegions,
    /** Whether a world tile is on terrain this map draws (the surface's ground floor, or a shown region). */
    shows: (point: WorldPoint) => drawable(point),
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
      const visible = (point: WorldPoint) => !hidden.has(classify(point)) && (placements.has(classify(point)) || picked.has(classify(point)));
      next.segments.forEach((segment, segmentIndex) => {
        const coordinates = segmentPoints(segment);
        if (segment.kind === "bank" || !coordinates.every(visible)) return;
        const feature = new Feature(new LineString(coordinates.map(projected)));
        feature.setProperties({ role: segment.kind, segmentIndex });
        previewSource.addFeature(feature);
      });
    },
    /** Centre a game tile where it is drawn, close enough to see its collision. */
    showTile(point: WorldPoint) { view.animate({ center: projected(point), resolution: Math.min(view.getResolution() ?? 2, 2), duration: 250 }); },
    /** How many overlay features of each kind are drawn (for end-to-end tests of bounded views). */
    featureCount() {
      const counts: Record<string, number> = { edge: 0, point: 0, hub: 0, station: 0, region: 0 };
      featureSource.forEachFeature(feature => { counts[feature.get("station") ? "station" : feature.get("kind")]++; });
      counts.mask = maskSource.getFeatures().filter(feature => feature.get("part") === "fill").length;
      return counts;
    },
    /** The drawn overlay's identity and appearance, for workbench map inspection tests. */
    featureSummary() {
      return featureSource.getFeatures().map(feature => ({
        key: feature.get("key") as string, kind: feature.get("kind") as string,
        tone: feature.get("tone") as string, dashed: !!feature.get("dashed"), role: feature.get("role") as string | undefined,
      }));
    },
    /** Where a world tile is drawn, in pixels from the map's top left (for end-to-end tests). */
    pixel(point: WorldPoint) { return map.getPixelFromCoordinate(projected(point)); },
    /** Replace the overlay's features and selection, keeping the layout (its anchors must be the same). */
    update(next?: FeatureOverlay) {
      overlay = next;
      routing.update(next?.routing);
      drawOverlay();
    },
    /** Bring the overlay's anchors into view, close enough to see their collision. */
    fitAnchors,
    /** Highlight an item's features and bring them into view. */
    selectFeature(key?: string, show = true) {
      if (overlay) overlay = { ...overlay, selected: key };
      featureLayer.changed();
      const shown = featuresOf(overlay?.features || [], key).flatMap(featurePoints).filter(point => !hidden.has(classify(point)) && drawable(point));
      if (show && shown.length) fitPoints(shown.map(projected), 10);
    },
    /** Show a rectangle of world tiles on one plane (on the surface, or an inset that shows it). */
    showBox(box: WorldBox) {
      const offset = box.reference ? placements.get(classify(box.reference))?.offset || [0, 0] : undefined;
      const project = (point: WorldPoint) => offset ? worldToMap(point).map((value, i) => value + offset[i]) : projected(point);
      const a = project({ x: box.x1, y: box.y1, plane: box.plane }), b = project({ x: box.x2, y: box.y2, plane: box.plane });
      view.fit([Math.min(a[0], b[0]) - 16, Math.min(a[1], b[1]) - 16, Math.max(a[0], b[0]) + 16, Math.max(a[1], b[1]) + 16], { padding: [70, 70, 70, 70], maxZoom: 10, duration: 250 });
    },
    /** Centre a world tile (where it is drawn) at a zoom level. */
    centre(point: WorldPoint, zoom?: number) { view.setCenter(projected(point)); if (zoom !== undefined) view.setZoom(zoom); },
    /** The world tile at the centre of the view, and the zoom level. */
    centreTile() { return { point: pickWorld(view.getCenter()!, assets, picked, 0), zoom: Math.round(view.getZoom() ?? 7) }; },
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

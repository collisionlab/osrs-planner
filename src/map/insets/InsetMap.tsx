import { useEffect, useMemo, useRef, useState } from "react";
import type { OsrsMapProps } from "../OsrsMap";
import type { WorldPoint } from "../../domain/contracts";
import { mapLayers, insetPin, type MapStyle } from "../layers";
import tiles from "../../../tiles.json";
import { loadInsetAssets, loadInsetEntrances, loadPlaneLinks, upperFloorDoors, type PlaneLink, type InsetArea, type InsetAssets, type InsetDoor, type InsetEntrances } from "./assets";
import { AreaPicker } from "./AreaPicker";
import { createComposition } from "./composition";
import { anchorsKey, layoutKey as overlayLayoutKey, type FeatureOverlay } from "./features";
import { catalogueClassifier } from "./preview";
import type { WorldBox } from "./projection";
import type { RoutingCrossing } from "./routing";
import "ol/ol.css";
import "../routeMarkers.css";
import "./styles.css";


const samePoint = (a?: WorldPoint, b?: WorldPoint) => a?.x === b?.x && a?.y === b?.y && a?.plane === b?.plane;
/** Whether the route shown is the one for the current endpoints. */
const routeMatches = ({ route, start, destination }: OsrsMapProps) =>
  !route || (samePoint(route.start.coordinate, start?.coordinate) && samePoint(route.destination.coordinate, destination?.coordinate));

export function InsetMap(props: OsrsMapProps & { style: MapStyle; onFallback(): void;
  /** Features over the map besides the route; changing them keeps the layout unless their anchors change. */
  overlay?: FeatureOverlay;
  /** Developer views only: inspect and copy the tile under the pointer. */
  inspectCoordinates?: boolean;
  /** A routing separator was clicked (with routing layers in the overlay). */
  onRoutingCrossing?(crossing: RoutingCrossing): void;
  /** Items under a click, by key (with an overlay), and the tile clicked. */
  onSelectFeatures?(keys: string[], point: WorldPoint): void;
  /** The world tiles in view after each move, a box per area drawn. */
  onView?(boxes: WorldBox[], resolution: number): void;
  /** Where the map first opens when there is nothing to fit. */
  initialCentre?: { point: WorldPoint; zoom: number };
  /** A tile to move the view to; a new object moves it again. */
  focusTile?: { point: WorldPoint };
  /** A box of tiles to show; a new object shows it again. */
  focusBox?: WorldBox;
  /** Whether selecting an item brings it into view (the default). */
  fitSelection?: boolean;
  /** Whether new anchors are brought into view (the default); read when the overlay changes. */
  fitAnchors?: boolean;
  /** Called with the composition once built, for tools that drive the view (and tests). */
  onReady?(map: ReturnType<typeof createComposition>): void;
  /** The inset release, when the page has loaded it already; otherwise the map loads the pinned one. */
  assets?: InsetAssets;
  /** Whether to offer the area search (the default). */
  areaPicker?: boolean;
  /** An inset's plane button was clicked; given, the page decides what to show instead of the map. */
  onPlane?(regionId: string, plane: number): void;
  /** Whether a rebuilt layout keeps the view where it is, rather than fitting what it shows. */
  keepView?: boolean;
  /** Regions to bring into view, by their real geometry; a new object fits them again. */
  focusRegions?: { ids: string[] };
  /**
   * Whether the map takes the focus back after a click anywhere else on the page that isn't for
   * typing (a layer checkbox, a list button), so its keys keep working: for tool pages whose map is
   * what everything else is about.
   */
  keepFocus?: boolean }) {
  const target = useRef<HTMLDivElement>(null);
  // After an endpoint drag the map is rebuilt for the new route; keep the view where the user left
  // it until the route for the new endpoints is shown, instead of fitting the whole route again.
  const keepView = useRef(false);
  const lastView = useRef<ReturnType<ReturnType<typeof createComposition>["view"]>>(undefined);
  const callbacks = useRef<typeof props>(props);
  callbacks.current = { ...props, onDragEndpoint: (role, point) => {
    if (!point) keepView.current = true;
    props.onDragEndpoint?.(role, point);
  } };
  const composition = useRef<ReturnType<typeof createComposition> | undefined>(undefined);
  const [loadedAssets, setAssets] = useState<InsetAssets>();
  const assets = props.assets || loadedAssets;
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  // Named areas shown without a route: from the search box, or by clicking an entrance on the map.
  const [entrances, setEntrances] = useState<InsetEntrances>();
  // Each shown area, entered from the door clicked, or else its default entrance.
  const [shownAreas, setShownAreas] = useState<{ regionId: string; entrance?: InsetArea["entrance"] }[]>([]);
  const focus = useRef<string>(undefined);
  // Ladders and staircases from the ground, which open the upper floors they lead to.
  const [links, setLinks] = useState<PlaneLink[]>();
  const floors = useMemo(() => assets && links ? upperFloorDoors(assets.catalogue, links) : undefined, [assets, links]);
  const doors = useMemo(() => [...entrances?.doors || [], ...floors?.doors || []], [entrances, floors]);
  const areasById = useMemo(() => new Map([...entrances?.areas || [], ...floors?.floors || []].map(area => [area.regionId, area])),
    [entrances, floors]);
  const shown = useMemo(() => shownAreas.flatMap(({ regionId, entrance }) => {
    const area = areasById.get(regionId);
    return area ? [{ ...area, entrance: entrance || area.entrance }] : [];
  }), [shownAreas, areasById]);
  const show = (regionId: string, entrance?: InsetArea["entrance"], move = true) => {
    if (move) focus.current = regionId;
    setShownAreas(current => [...current.filter(area => area.regionId !== regionId), { regionId, entrance }]);
  };
  const hide = (regionIds: string[]) => setShownAreas(current => current.filter(area => !regionIds.includes(area.regionId)));
  // The plane each inset shows, by the region it was laid out for (see areaFloors).
  const [planes, setPlanes] = useState<Record<string, number>>({});
  const choosePlane = useRef((_: string, __: number) => {});
  choosePlane.current = (regionId, plane) => props.onPlane ? props.onPlane(regionId, plane) : setPlanes(current => ({ ...current, [regionId]: plane }));
  const toggleDoor = useRef((_: InsetDoor) => {});
  // A building's floors open beside it, where the view already is.
  toggleDoor.current = door => door.regionIds.every(id => shownAreas.some(area => area.regionId === id)) ? hide(door.regionIds)
    : door.regionIds.forEach(id => show(id, door.inside[id] && { surface: door.point, inside: door.inside[id], wayIn: true }, !door.floors));
  useEffect(() => {
    if (props.assets) return;
    const abort = new AbortController();
    if (!insetPin || insetPin.tileVersion !== tiles.version) { setError("Insets are not available for these map tiles."); return; }
    void loadInsetAssets(`${tiles.base}/insets/${insetPin.version}`, tiles.version, abort.signal)
      .then(value => { if (!abort.signal.aborted) setAssets(value); })
      .catch(error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!assets || props.areaPicker === false) return;
    const abort = new AbortController();
    // Without entrances the map still works; there is just no area search.
    void loadInsetEntrances(assets, abort.signal).then(value => { if (!abort.signal.aborted) setEntrances(value); }, () => {});
    void loadPlaneLinks(abort.signal).then(value => { if (!abort.signal.aborted) setLinks(value); }, () => {});
    return () => abort.abort();
  }, [assets]);
  // Showing or hiding an area keeps the view (or moves to the new area) instead of fitting the route.
  const areasChanged = useRef(false);
  useEffect(() => { areasChanged.current = true; }, [shown, doors, planes]);
  // An overlay is laid out by its anchors (and the names they give areas); new features alone are redrawn.
  const classify = useMemo(() => assets && catalogueClassifier(assets.catalogue, { detachUpperFloors: true }), [assets]);
  const layoutKey = useMemo(() => classify ? overlayLayoutKey(props.overlay, classify) : "", [props.overlay, classify]);
  const drawnAnchors = useRef("");
  const overlay = useRef(props.overlay);
  overlay.current = props.overlay;
  useEffect(() => {
    if (!assets || !target.current) return;
    try {
      // Insets are cut from the pinned pyramid of the map's own style, and the surface under them
      // comes from the same pyramid so the two line up; tactical when the pin lacks the style.
      const style = tiles.styles.includes(props.style) ? props.style : "tactical";
      const terrain = { base: `${tiles.base}/${style}/${tiles.version}` };
      const layer = style === props.style
        ? { url: `${terrain.base}/{z}/{x}/{y}.png`, maxNativeZoom: 8, attribution: mapLayers[style]?.attribution || "" }
        : mapLayers[props.style] || mapLayers.standard!;
      const previous = keepView.current || areasChanged.current || props.keepView ? lastView.current : undefined;
      areasChanged.current = false;
      if (keepView.current && routeMatches(props)) keepView.current = false;
      const instance = createComposition(target.current, assets, props, () => callbacks.current, layer,
        terrain, setStatus, previous,
        { shown, doors, onDoor: door => toggleDoor.current(door), planes, onPlane: (regionId, plane) => choosePlane.current(regionId, plane),
          overlay: overlay.current, inspectCoordinates: props.inspectCoordinates,
          onRoutingCrossing: crossing => callbacks.current.onRoutingCrossing?.(crossing),
          onSelectFeatures: props.onSelectFeatures && ((keys, point) => callbacks.current.onSelectFeatures?.(keys, point)),
          onView: props.onView && ((boxes, resolution) => callbacks.current.onView?.(boxes, resolution)) });
      composition.current = instance;
      // A link to a place opens there, unless the page wants its anchors in view.
      if (!previous && props.initialCentre && !props.route && (!overlay.current?.anchors.length || props.fitAnchors === false)) instance.centre(props.initialCentre.point, props.initialCentre.zoom);
      drawnAnchors.current = anchorsKey(overlay.current);
      props.onReady?.(instance);
      // End-to-end tests find tiles on the map through this; it isn't in production builds.
      if (import.meta.env.DEV) (window as unknown as { insetMap?: typeof instance }).insetMap = instance;
      if (focus.current) { instance.fitRegion(focus.current); focus.current = undefined; }
      if (!previous && props.focusRegions) instance.fitRegions(props.focusRegions.ids);
      instance.select(callbacks.current.selectedSegment);
      return () => { lastView.current = instance.view(); composition.current = undefined; instance.dispose(); };
    } catch (error) { setError(String(error)); }
  }, [assets, props.route, props.start, props.destination, props.style, shown, doors, planes, layoutKey, props.inspectCoordinates]);
  useEffect(() => {
    const instance = composition.current;
    if (!instance) return;
    instance.update(props.overlay);
    const anchors = anchorsKey(props.overlay);
    if (anchors !== drawnAnchors.current) { drawnAnchors.current = anchors; if (props.fitAnchors ?? true) instance.fitAnchors(); }
  }, [props.overlay]);
  useEffect(() => { composition.current?.selectFeature(props.overlay?.selected, props.fitSelection ?? true); }, [props.overlay?.selected]);
  useEffect(() => { if (props.focusBox) composition.current?.showBox(props.focusBox); }, [props.focusBox]);
  useEffect(() => { if (props.focusRegions) composition.current?.fitRegions(props.focusRegions.ids); }, [props.focusRegions]);
  useEffect(() => { composition.current?.select(props.selectedSegment); }, [props.selectedSegment]);
  useEffect(() => { composition.current?.preview(props.previewRoute); }, [props.previewRoute]);
  useEffect(() => { if (props.focusTile) composition.current?.showTile(props.focusTile.point); }, [props.focusTile]);
  useEffect(() => {
    if (!props.keepFocus) return;
    // Pointer clicks only: a keyboard user moving through the page keeps their place.
    const refocus = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || target.current?.contains(element) || typing(element)) return;
      requestAnimationFrame(() => { if (!typing(document.activeElement)) target.current?.focus({ preventScroll: true }); });
    };
    addEventListener("pointerup", refocus);
    return () => removeEventListener("pointerup", refocus);
  }, [props.keepFocus]);
  return <>
    <div ref={target} className="route-map inset-map" tabIndex={0} aria-label="Route map with movable insets" />
    <div className="inset-actions">
      {props.overlay ? <button type="button" onClick={() => composition.current?.fitAnchors()}>{props.overlay.anchors.length ? "Fit selection" : "Fit"}</button>
        : <button type="button" onClick={() => composition.current?.fit()}>Fit route</button>}
      <button type="button" onClick={() => composition.current?.reset()}>Reset insets</button>
    </div>
    {assets && props.areaPicker !== false && <AreaPicker areas={entrances?.areas} shown={shown} onShow={area => show(area.regionId)} onHide={area => hide(shown.filter(other => other.name === area.name).map(other => other.regionId))} />}
    {(error || status || !assets) && <div className="map-message" role="status">
      {error || status || "Loading inset terrain…"}
      {error && <button type="button" onClick={props.onFallback}>Use standard map</button>}
    </div>}
  </>;
}

/** Whether an element takes typing, so taking the focus from it would lose what is typed. */
function typing(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(element.type);
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element as HTMLElement).isContentEditable;
}

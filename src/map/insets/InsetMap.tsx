import { useEffect, useMemo, useRef, useState } from "react";
import type { OsrsMapProps } from "../OsrsMap";
import type { WorldPoint } from "../../domain/contracts";
import { mapLayers, insetPin, type MapStyle } from "../layers";
import tiles from "../../../tiles.json";
import { loadInsetAssets, loadInsetEntrances, loadPlaneLinks, upperFloorDoors, type PlaneLink, type InsetArea, type InsetAssets, type InsetDoor, type InsetEntrances } from "./assets";
import { AreaPicker } from "./AreaPicker";
import { createComposition } from "./composition";
import "ol/ol.css";
import "../routeMarkers.css";
import "./styles.css";


const samePoint = (a?: WorldPoint, b?: WorldPoint) => a?.x === b?.x && a?.y === b?.y && a?.plane === b?.plane;
/** Whether the route shown is the one for the current endpoints. */
const routeMatches = ({ route, start, destination }: OsrsMapProps) =>
  !route || (samePoint(route.start.coordinate, start?.coordinate) && samePoint(route.destination.coordinate, destination?.coordinate));

export function InsetMap(props: OsrsMapProps & { style: MapStyle; onFallback(): void }) {
  const target = useRef<HTMLDivElement>(null);
  // After an endpoint drag the map is rebuilt for the new route; keep the view where the user left
  // it until the route for the new endpoints is shown, instead of fitting the whole route again.
  const keepView = useRef(false);
  const lastView = useRef<ReturnType<ReturnType<typeof createComposition>["view"]>>(undefined);
  const callbacks = useRef(props);
  callbacks.current = { ...props, onDragEndpoint: (role, point) => {
    if (!point) keepView.current = true;
    props.onDragEndpoint?.(role, point);
  } };
  const composition = useRef<ReturnType<typeof createComposition> | undefined>(undefined);
  const [assets, setAssets] = useState<InsetAssets>();
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
  choosePlane.current = (regionId, plane) => setPlanes(current => ({ ...current, [regionId]: plane }));
  const toggleDoor = useRef((_: InsetDoor) => {});
  // A building's floors open beside it, where the view already is.
  toggleDoor.current = door => door.regionIds.every(id => shownAreas.some(area => area.regionId === id)) ? hide(door.regionIds)
    : door.regionIds.forEach(id => show(id, door.inside[id] && { surface: door.point, inside: door.inside[id], wayIn: true }, !door.floors));
  useEffect(() => {
    const abort = new AbortController();
    if (!insetPin || insetPin.tileVersion !== tiles.version) { setError("Insets are not available for these map tiles."); return; }
    void loadInsetAssets(`${tiles.base}/insets/${insetPin.version}`, tiles.version, abort.signal)
      .then(value => { if (!abort.signal.aborted) setAssets(value); })
      .catch(error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!assets) return;
    const abort = new AbortController();
    // Without entrances the map still works; there is just no area search.
    void loadInsetEntrances(assets, abort.signal).then(value => { if (!abort.signal.aborted) setEntrances(value); }, () => {});
    void loadPlaneLinks(abort.signal).then(value => { if (!abort.signal.aborted) setLinks(value); }, () => {});
    return () => abort.abort();
  }, [assets]);
  // Showing or hiding an area keeps the view (or moves to the new area) instead of fitting the route.
  const areasChanged = useRef(false);
  useEffect(() => { areasChanged.current = true; }, [shown, doors, planes]);
  useEffect(() => {
    if (!assets || !target.current) return;
    try {
      // Insets are cut from the pinned pyramid of the map's own style, and the surface under them
      // comes from the same pyramid so the two line up; tactical when the pin lacks the style.
      const style = tiles.styles.includes(props.style) ? props.style : "tactical";
      const terrain = { base: `${tiles.base}/${style}/${tiles.version}` };
      const layer = style === props.style
        ? { url: `${terrain.base}/{z}/{x}/{y}.png`, maxNativeZoom: 8, attribution: mapLayers.tactical?.attribution || "" }
        : mapLayers[props.style] || mapLayers.standard!;
      const previous = keepView.current || areasChanged.current ? lastView.current : undefined;
      areasChanged.current = false;
      if (keepView.current && routeMatches(props)) keepView.current = false;
      const instance = createComposition(target.current, assets, props, () => callbacks.current, layer,
        terrain, setStatus, previous,
        { shown, doors, onDoor: door => toggleDoor.current(door), planes, onPlane: (regionId, plane) => choosePlane.current(regionId, plane) });
      composition.current = instance;
      // End-to-end tests find tiles on the map through this; it isn't in production builds.
      if (import.meta.env.DEV) (window as unknown as { insetMap?: typeof instance }).insetMap = instance;
      if (focus.current) { instance.fitRegion(focus.current); focus.current = undefined; }
      instance.select(callbacks.current.selectedSegment);
      return () => { lastView.current = instance.view(); composition.current = undefined; instance.dispose(); };
    } catch (error) { setError(String(error)); }
  }, [assets, props.route, props.start, props.destination, props.style, shown, doors, planes]);
  useEffect(() => { composition.current?.select(props.selectedSegment); }, [props.selectedSegment]);
  useEffect(() => { composition.current?.preview(props.previewRoute); }, [props.previewRoute]);
  return <>
    <div ref={target} className="route-map inset-map" tabIndex={0} aria-label="Route map with movable insets" />
    <div className="inset-actions">
      <button type="button" onClick={() => composition.current?.fit()}>Fit route</button>
      <button type="button" onClick={() => composition.current?.reset()}>Reset insets</button>
    </div>
    {assets && <AreaPicker areas={entrances?.areas} shown={shown} onShow={area => show(area.regionId)} onHide={area => hide(shown.filter(other => other.name === area.name).map(other => other.regionId))} />}
    {(error || status || !assets) && <div className="map-message" role="status">
      {error || status || "Loading inset terrain…"}
      {error && <button type="button" onClick={props.onFallback}>Use standard map</button>}
    </div>}
  </>;
}

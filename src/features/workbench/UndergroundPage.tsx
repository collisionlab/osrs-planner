import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapStyle } from "../../map/layers";
import { loadInsetAssets, type InsetAssets } from "../../map/insets/assets";
import type { FeatureOverlay } from "../../map/insets/features";
import { LayerControl } from "../../map/insets/LayerControl";
import { catalogueClassifier } from "../../map/insets/preview";
import type { WorldBox } from "../../map/insets/projection";
import { RoutingData, type RoutingPin, type UnreachedArea } from "../../map/insets/routing";
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { areaBox, areaFeatures, areaId, issuesUrl, listed, LISTED_TILES, loadWorldMaps, mapRegions, representative, undergroundMaps,
  type UndergroundMap } from "./underground";
import { useUrlLayerSettings, useWorkbenchLayers } from "./WorkbenchLayers";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));
const UNDERGROUND_LAYERS = ["collision", "unreachable"];

type Loaded = { assets: InsetAssets; maps: UndergroundMap[] } | { error: string };
const pin = tiles.routingLayers as RoutingPin | null;

async function load(signal: AbortSignal): Promise<Loaded> {
  if (!insetPin || insetPin.tileVersion !== tiles.version) return { error: "No inset release is pinned for these map tiles." };
  if (!pin) return { error: "No routing release is pinned." };
  const [assets, routing] = await Promise.all([
    loadInsetAssets(`${tiles.base}/insets/${insetPin.version}`, tiles.version, signal),
    RoutingData.load(`${tiles.base}/routing-layers/${pin.version}`, pin, pin.tileVersion, signal),
  ]);
  const [maps, areas] = await Promise.all([loadWorldMaps(assets, signal), routing.unreached()]);
  if (!maps) return { error: `The pinned inset release (${insetPin.version.slice(0, 12)}) was built before osrs-tiles published world maps.` };
  if (!areas) return { error: `The pinned routing release (${pin.version.slice(0, 12)}) was built before osrs-tiles published its unreached areas.` };
  return { assets, maps: undergroundMaps(maps, areas) };
}

/**
 * Every world map besides the main one, to go through one by one: the map's real tiles on the inset
 * map, plane by plane, with the walking areas in it that no chain of transports reaches (the pinned
 * routing release, so the plugin's own graph) listed largest first. `j`/`k` move between maps and
 * `n`/`p` between a map's areas; the URL names the map, plane and area.
 */
export function UndergroundPage() {
  const { map: wanted } = useParams();
  const location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const wantedArea = new URLSearchParams(location.hash.slice(1)).get("area");
  const [loaded, setLoaded] = useState<Loaded>();
  const [manifest, setManifest] = useState<CollisionManifest>();
  const [style, setStyle] = useState(savedStyle);
  useEffect(() => {
    document.title = "Underground areas · Workbench";
    const abort = new AbortController();
    load(abort.signal).then(setLoaded, reason => { if (!abort.signal.aborted) setLoaded({ error: String(reason instanceof Error ? reason.message : reason) }); });
    loadCollisionManifest(abort.signal).then(setManifest, () => {});
    return () => abort.abort();
  }, []);
  const maps = loaded && "maps" in loaded ? loaded.maps : [];
  const index = Math.max(0, maps.findIndex(map => map.safeName === wanted));
  const map = maps[index];
  const areas = useMemo(() => map ? listed(map) : [], [map]);
  const areaIndex = areas.findIndex(area => areaId(area) === wantedArea);
  const area: UnreachedArea | undefined = areas[areaIndex];
  const planeParam = params.get("plane");
  const plane = area?.plane ?? (planeParam && map?.planes.includes(Number(planeParam)) ? Number(planeParam) : map?.planes[0] ?? 0);

  const go = (target: UndergroundMap | undefined, next: { plane?: number; area?: UnreachedArea } = {}, replace = false) => {
    if (!target) return;
    const search = new URLSearchParams(params);
    search.delete("plane");
    if (next.plane !== undefined && next.plane !== target.planes[0]) search.set("plane", String(next.plane));
    navigate({ pathname: `/underground/${target.safeName}`, search: search.toString(), hash: next.area ? "area=" + areaId(next.area) : "" }, { replace });
  };
  const selectMap = (next: number) => { const target = maps[Math.max(0, Math.min(maps.length - 1, next))]; go(target, { plane: target?.planes[0] }); };
  const selectArea = (next: number) => {
    const target = areas[Math.max(0, Math.min(areas.length - 1, next))];
    if (target) go(map, { plane: target.plane, area: target });
  };
  const selectPlane = (next: number) => { if (map && next !== plane) go(map, { plane: next }); };
  // An unknown map in the URL opens the first; the URL then names it.
  useEffect(() => { if (map && map.safeName !== wanted) go(map, {}, true); }, [map, wanted]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)
        || event.metaKey || event.ctrlKey || event.altKey) return;
      const moves: Record<string, () => void> = { j: () => selectMap(index + 1), k: () => selectMap(index - 1),
        n: () => selectArea(areaIndex + 1), p: () => selectArea(areaIndex < 0 ? 0 : areaIndex - 1) };
      if (moves[event.key]) { event.preventDefault(); moves[event.key](); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [index, areaIndex, maps, areas, location.search]);

  const assets = loaded && "assets" in loaded ? loaded.assets : undefined;
  const classify = useMemo(() => assets && catalogueClassifier(assets.catalogue, { detachUpperFloors: true }), [assets]);
  const regions = useMemo(() => map && assets ? mapRegions(map, plane, assets.catalogue.regions).map(region => region.id) : [], [map, plane, assets]);
  const size = (id: string) => assets?.catalogue.regions.find(region => region.id === id)?.tileCount ?? 0;
  const geometry = useMemo<FeatureOverlay | undefined>(() => map && assets ? {
    features: areaFeatures(map, plane), anchors: [], selected: area && areaId(area), regions: regions.map(regionId => ({ regionId })),
  } : undefined, [map, plane, area, assets, regions]);

  // The map follows the page: the chosen area, or else the region on the plane holding its largest
  // listed area (its largest region when none is). A map's parts can be thousands of tiles apart, so
  // fitting them all would show none of them.
  const [focusBox, setFocusBox] = useState<WorldBox>();
  const [focusRegions, setFocusRegions] = useState<{ ids: string[] }>();
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  useEffect(() => {
    if (!map || !classify) return;
    if (area) { setFocusBox(areaBox(area)); return; }
    const largest = areas.find(other => other.plane === plane);
    const id = largest ? classify(representative(largest)) : [...regions].sort((x, y) => size(y) - size(x))[0];
    if (id) setFocusRegions({ ids: [id] });
  }, [map?.safeName, plane, area && areaId(area), classify]);
  const [settings, updateSettings] = useUrlLayerSettings();
  const [inspected, setInspected] = useState<WorldPoint>();
  const layers = useWorkbenchLayers({ settings, update: updateSettings, defaults: UNDERGROUND_LAYERS, overlay: geometry, inspected, focus: setFocusBox });
  const smaller = map ? map.areas.length - areas.length : 0;
  const total = maps.reduce((sum, other) => sum + other.tiles, 0);

  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link><span className="wb-tool">Underground areas</span>
      {maps.length > 0 && <span className="wb-summary">{maps.length} world maps · {total.toLocaleString()} unreached tiles</span>}
      <span className="wb-keys"><kbd>j</kbd>/<kbd>k</kbd> next/previous map · <kbd>n</kbd>/<kbd>p</kbd> next/previous area</span>
    </header>
    {!loaded ? <p className="wb-message" role="status">Loading the world maps and the routing release…</p>
      : "error" in loaded ? <p className="wb-message" role="alert">{loaded.error}</p>
      : <div className="wb-body wb-invariants-body">
        <nav className="wb-units" aria-label="World maps">
          <ol>{maps.map((other, i) => <li key={other.safeName}><button type="button" aria-current={index === i} onClick={() => selectMap(i)}>
            <span className="wb-unit-title">{other.name}</span>
            <span className="wb-unit-meta">{other.tiles ? `${other.tiles.toLocaleString()} unreached tiles · ${listed(other).length} areas` : "nothing unreached"}</span>
          </button></li>)}</ol>
        </nav>
        <section className="wb-map wb-insets-map" aria-label="Underground map">
          {geometry ? <Suspense fallback={<p className="wb-message">Loading inset map…</p>}>
            <InsetMap inspectCoordinates assets={assets} areaPicker={false} overlay={layers.overlay} style={style} insets keepView fitAnchors={false} fitSelection={false}
              focusBox={focusBox} focusRegions={focusRegions} focusTile={focusTile} onPlane={(_, next) => selectPlane(next)} onFallback={() => {}}
              onPick={point => { layers.clearPick(); setInspected(point); }}
              onView={layers.onView} onMoveHub={layers.moveHub} onRoutingCrossing={layers.routing.selectCrossing}
              onSelectFeatures={(keys, point) => {
                const chosen = areas.find(other => keys.includes(areaId(other)));
                if (chosen) { go(map, { plane: chosen.plane, area: chosen }); return; }
                if (!layers.pick(keys)) setInspected(point);
              }} />
          </Suspense> : <p className="wb-message">No world map selected.</p>}
          {map && map.planes.length > 1 && <div className="wb-map-tools">
            <div className="map-style-toggle" role="group" aria-label="Plane shown">
              {map.planes.map(other => <button key={other} type="button" aria-pressed={other === plane} onClick={() => selectPlane(other)}>Plane {other}</button>)}
            </div>
          </div>}
          <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {Object.entries(mapLayers).map(([id, layer]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id as MapStyle); saveStyle(id as MapStyle); }}>{layer.label}</button>)}
          </div>
          <LayerControl layers={layers.layers} onToggle={layers.toggle} />
        </section>
        <section className="wb-side-panel" aria-label="Map details">
          <div className="wb-panel-body">
            {map && <article className="wb-section" aria-label="Unreached areas">
              <h2>{map.name}</h2>
              <p className="wb-note">Walking areas in this map's real tiles that no chain of transports reaches from Lumbridge, whatever their
                requirements, in the pinned plugin's own graph. Some are unused floor or instanced content.</p>
              <p><a href={issuesUrl(map)} target="_blank" rel="noreferrer">Its issue on GitHub ↗</a></p>
              {areas.length ? <ol className="wb-list">{areas.map((other, i) => <li key={areaId(other)}>
                <button type="button" className="wb-item" aria-current={i === areaIndex} onClick={() => selectArea(i)}>
                  <b>{other.tiles.toLocaleString()} tiles</b> <span className="wb-note">plane {other.plane} · <span className="wb-mono">{other.representative[0]} {other.representative[1]}</span></span>
                </button>
                {i === areaIndex && <button type="button" className="wb-small" onClick={() => setFocusTile({ point: representative(other) })}>
                  Show a tile of it</button>}
              </li>)}</ol> : <p>Nothing of {LISTED_TILES} tiles or more is unreached.</p>}
              {smaller > 0 && <p className="wb-note">And {smaller.toLocaleString()} smaller fragment{smaller === 1 ? "" : "s"}, not listed.</p>}
            </article>}
            {layers.panel}
            {layers.routing.panel && <div className="wb-detail">{layers.routing.panel}</div>}
          </div>
        </section>
      </div>}
    <footer className="wb-footer">
      {pin && <span className="wb-prov ok"><b>Plugin</b> Skretzo/shortest-path@{pin.pluginRevision.slice(0, 7)}, as the routing layers were built from it</span>}
      {provenance(undefined, manifest).filter(line => line.subject !== "Transport data")
        .map(line => <span key={line.subject} className={`wb-prov ${line.status}`}><b>{line.subject}</b> {line.text}</span>)}
    </footer>
  </div>;
}

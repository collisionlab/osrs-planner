import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../../tiles.json";
import type { WorldPoint } from "../../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapLayer, type MapStyle } from "../../../map/layers";
import { loadInsetAssets, type InsetAssets } from "../../../map/insets/assets";
import { CollisionMap, releaseTiles } from "../../../map/insets/collision";
import { COLLISION_RADIUS } from "../../../map/insets/composition";
import { catalogueClassifier } from "../../../map/insets/preview";
import type { WorldBox } from "../../../map/insets/projection";
import { loadCollisionManifest, provenance, type CollisionManifest } from "../provenance";
import { loadMeta, loadView, type TransportMeta, type TransportView } from "../transports";
import "../workbench.css";
import { AreaBrowser } from "./AreaBrowser";
import { loadInvestigation, tilePoint, type Area, type AreaFilter, type InvestigationData } from "./data";
import type { CorrectionInput } from "./drafts";
import { emptyCorrection, LabellingPanel, type PickTarget } from "./LabellingPanel";
import { investigationOverlay, keyId, keyKind } from "./overlay";
import { useRoutingLayers } from "./RoutingPanel";
import { readState, releaseId, writeState, type InvestigationState } from "./state";
import { areaTopology, gapAreas, loadTopology, reportChecks, type TopologyState } from "./topology";
import { nearbyBox, TopologyPanel } from "./TopologyPanel";

const InsetMap = lazy(() => import("../../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));

const LUMBRIDGE = { point: { x: 3222, y: 3218, plane: 0 }, zoom: 7 };
/** The service takes at most this many boxes a view. */
const MAX_BOXES = 24;
const box = (id: string, data: InvestigationData): WorldBox | undefined => {
  const region = data.regions.get(id);
  return region && { plane: region.plane, x1: region.bounds[0], y1: region.bounds[1], x2: region.bounds[2] - 1, y2: region.bounds[3] - 1 };
};

type MapHandle = { centreTile(): { point: WorldPoint; zoom: number }; shows(point: WorldPoint): boolean };

/**
 * The workbench's inset investigation: pick a geographical area, see its inset regions on the
 * shared inset map, and investigate it in two modes over the same selection and view: Topology
 * (connections, the tooling's walking components and candidate links, a link drafted by hand) and
 * Labelling (names, evidence, anchors, a correction drafted by hand).
 */
export function InsetInvestigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<InvestigationState>(() => readState(location.search));
  const update = (next: Partial<InvestigationState>) => setState(current => ({ ...current, ...next }));
  useEffect(() => {
    const search = writeState(state);
    if (search !== location.search) navigate({ search }, { replace: true });
  }, [state]);
  useEffect(() => { document.title = "Inset investigation · Workbench"; }, []);

  const [assets, setAssets] = useState<InsetAssets>();
  const [data, setData] = useState<InvestigationData>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!insetPin || insetPin.tileVersion !== tiles.version) { setError("No inset release is pinned for these map tiles."); return; }
    const abort = new AbortController();
    loadInsetAssets(`${tiles.base}/insets/${insetPin.version}`, tiles.version, abort.signal)
      .then(loaded => { if (abort.signal.aborted) return; setAssets(loaded); return loadInvestigation(loaded, abort.signal).then(setData); })
      .catch(reason => { if (!abort.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => abort.abort();
  }, []);
  const [topologyState, setTopology] = useState<TopologyState>({ state: "loading" });
  const [meta, setMeta] = useState<TransportMeta>();
  const [collisionManifest, setCollisionManifest] = useState<CollisionManifest>();
  useEffect(() => {
    const abort = new AbortController();
    loadTopology(abort.signal).then(setTopology, () => {});
    loadMeta(abort.signal).then(setMeta, () => {});
    loadCollisionManifest(abort.signal).then(setCollisionManifest, () => {});
    return () => abort.abort();
  }, []);

  const classify = useMemo(() => assets ? catalogueClassifier(assets.catalogue, { detachUpperFloors: true }) : () => "unmapped", [assets]);
  const report = topologyState.state === "loaded" ? topologyState.report : undefined;
  const checks = useMemo(() => report && reportChecks(report, { cacheId: Number(tiles.version.split("-")[0]), plugin: meta?.plugin,
    collisionDumperRev: collisionManifest?.dumperSource?.rev }), [report, meta, collisionManifest]);
  const gaps = useMemo(() => report && data ? gapAreas(report, data.areasOfRegion, classify) : undefined, [report, data, classify]);

  const area = data && state.area ? data.byId.get(state.area) : undefined;
  const plane: number = state.plane ?? (state.region ? data?.regions.get(state.region)?.plane : undefined) ?? area?.planes[0] ?? 0;
  const topology = useMemo(() => report && area && data ? areaTopology(report, area, data.regions) : undefined, [report, area, data]);
  const candidate = keyKind(state.item) === "cand" ? report?.candidates.find(other => other.id === keyId(state.item!)) : undefined;

  // The map follows the page: an area's regions fitted when chosen, a tile or box when shown.
  const [focusRegions, setFocusRegions] = useState<{ ids: string[] }>();
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  const [focusBox, setFocusBox] = useState<WorldBox>();
  const onPlaneRegions = (target: Area | undefined, onPlane: number) => target?.regionIds.filter(id => data?.regions.get(id)?.plane === onPlane) || [];
  // A link opens on its area unless it names a place.
  const opened = useRef(false);
  useEffect(() => {
    if (!data || opened.current) return;
    opened.current = true;
    if (area && !state.at) setFocusRegions({ ids: state.region ? [state.region] : onPlaneRegions(area, plane) });
  }, [data]);

  const [correction, setCorrection] = useState<CorrectionInput>(() => emptyCorrection(undefined, undefined));
  const [draft, setDraft] = useState<{ origin?: WorldPoint; destination?: WorldPoint }>({});
  const [picking, setPicking] = useState<PickTarget>();
  const [inspected, setInspected] = useState<WorldPoint>();
  const correctionFor = useRef<string>(undefined);
  useEffect(() => {
    if (area && correctionFor.current !== area.id) { correctionFor.current = area.id; setCorrection(emptyCorrection(area, state.region)); }
  }, [area]);

  const chooseArea = (next: Area, regionId?: string) => {
    const nextPlane = regionId ? data!.regions.get(regionId)!.plane : next.planes[0];
    const largest = regionId || [...onPlaneRegions(next, nextPlane)].sort((a, b) => (data!.regions.get(b)?.tileCount ?? 0) - (data!.regions.get(a)?.tileCount ?? 0))[0];
    update({ area: next.id, region: largest, plane: nextPlane, item: undefined, release: releaseId(insetPin!.version) });
    setFocusRegions({ ids: regionId ? [regionId] : onPlaneRegions(next, nextPlane) });
  };
  const choosePlane = (next: number) => {
    if (!area || next === plane) return;
    const region = state.region && data?.regions.get(state.region)?.plane === next ? state.region : onPlaneRegions(area, next)[0];
    update({ plane: next, region });
  };
  const chooseRegion = (regionId: string) => {
    const region = data?.regions.get(regionId);
    if (!region) return;
    if (area?.regionIds.includes(regionId)) { update({ region: regionId, plane: region.plane }); setFocusRegions({ ids: [regionId] }); return; }
    const owner = data!.areasOfRegion.get(regionId)?.[0];
    if (owner) chooseArea(data!.byId.get(owner)!, regionId);
  };

  // Transports on the area's terrain, from the explorer's catalogue, and near the ends being looked at.
  const [transports, setTransports] = useState<{ view: TransportView; boxes: WorldBox[] }>();
  const areaBoxes = useMemo(() => data && area ? onPlaneRegions(area, plane).map(id => box(id, data)!).filter(Boolean)
    .sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1)).slice(0, MAX_BOXES) : undefined, [data, area, plane]);
  useEffect(() => {
    setTransports(undefined);
    if (!areaBoxes?.length || state.mode !== "topology") return;
    const abort = new AbortController();
    loadView(areaBoxes, undefined, abort.signal).then(view => setTransports({ view, boxes: areaBoxes }), () => {});
    return () => abort.abort();
  }, [areaBoxes, state.mode]);
  const ends = useMemo(() => [draft.origin, draft.destination, ...candidate ? [tilePoint(candidate.from.point), tilePoint(candidate.to.point)] : []]
    .filter((point): point is WorldPoint => !!point), [draft, candidate]);
  const endsKey = JSON.stringify(ends);
  const [nearby, setNearby] = useState<TransportView>();
  useEffect(() => {
    setNearby(undefined);
    if (!ends.length) return;
    const abort = new AbortController();
    loadView(ends.map(nearbyBox), undefined, abort.signal).then(setNearby, () => setNearby({ total: 0, transports: [], clusters: [] }));
    return () => abort.abort();
  }, [endsKey]);

  // Collision around the tiles being looked at.
  const collision = useMemo(() => new CollisionMap(releaseTiles(tiles.base, tiles.version)), []);
  const looked = useMemo(() => [...ends, ...inspected ? [inspected] : []], [endsKey, inspected]);
  const [collisionFor, setCollisionFor] = useState("");
  useEffect(() => {
    if (!looked.length) return;
    const abort = new AbortController(), want = JSON.stringify(looked);
    void collision.load(looked, COLLISION_RADIUS + 1, abort.signal).then(() => { if (!abort.signal.aborted) setCollisionFor(want); });
    return () => abort.abort();
  }, [looked, collision]);
  const collisionReady = collisionFor === JSON.stringify(looked);

  const routing = useRoutingLayers(inspected, setFocusBox);
  const baseOverlay = useMemo(() => data && investigationOverlay({ data, area, plane, mode: state.mode, region: state.region, item: state.item,
    beside: !!state.beside, topology, candidate, transports, draft, inspected, classify,
    collision: collisionReady ? collision : undefined }), [data, area, plane, state.mode, state.region, state.item, state.beside, topology, checks, candidate, transports, draft, inspected, classify, collisionReady, collision]);

  const overlay = useMemo(() => baseOverlay ? { ...baseOverlay, routing: routing.overlay } : undefined, [baseOverlay, routing.overlay]);

  const mapRef = useRef<MapHandle>(undefined);
  const onPick = (point: WorldPoint) => {
    if (picking === "origin" || picking === "destination") { setDraft(current => ({ ...current, [picking]: point })); setPicking(undefined); return; }
    if (picking === "seed") { setCorrection(current => ({ ...current, seed: point })); setPicking(undefined); return; }
    if (picking === "anchor") { setCorrection(current => ({ ...current, anchor: { reason: "", entrance: false, ...current.anchor, point } })); setPicking(undefined); return; }
    if (!mapRef.current?.shows(point)) { setInspected(undefined); return; }
    setInspected(point);
    const regionId = classify(point);
    if (data?.regions.get(regionId)?.classification === "inset" && regionId !== state.region) {
      if (area?.regionIds.includes(regionId)) update({ region: regionId });
      else { const owner = data.areasOfRegion.get(regionId)?.[0]; if (owner) chooseArea(data.byId.get(owner)!, regionId); }
    }
  };
  // A click on a feature picks it, unless a tile is being chosen; a region's own marks select the region.
  const onSelectFeatures = (keys: string[], point: WorldPoint) => {
    if (picking) { onPick(point); return; }
    setInspected(point);
    const chosen = keys.find(k => keyKind(k) !== "region" && k !== "tile" && k !== "draft");
    if (chosen) update({ item: chosen });
    else { const region = keys.find(k => keyKind(k) === "region"); if (region) chooseRegion(keyId(region)); }
  };
  const showPoint = (point: WorldPoint) => setFocusTile({ point });

  const [filter, setFilter] = useState<AreaFilter>(() => ({ text: state.q, minTiles: 50 }));
  useEffect(() => { update({ q: filter.text || undefined }); }, [filter.text]);
  const [style, setStyle] = useState(savedStyle);
  const styles = Object.entries(mapLayers) as [MapStyle, MapLayer][];
  const lines = provenance(meta, collisionManifest, "Transports");
  const release = insetPin && releaseId(insetPin.version);
  const staleLink = state.release && release && state.release !== release;
  const missingArea = data && state.area && !area;
  const selectedRegion = state.region ? data?.regions.get(state.region) : undefined;
  const unanchored = selectedRegion && !data?.anchors.regions[selectedRegion.id]?.anchors.length;

  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link>
      <span className="wb-tool">Inset investigation</span>
      {data && <span className="wb-summary">{data.areas.length.toLocaleString()} areas · inset release {release}</span>}
    </header>
    {error && <p className="wb-warning" role="alert">{error}</p>}
    {staleLink && <p className="wb-warning" role="alert">This link was made for inset release {state.release}; this page shows {release}. Regions whose terrain changed have new ids and won't be found.</p>}
    {missingArea && <p className="wb-warning" role="alert">No area {state.area} in inset release {release}.</p>}
    {data && data.investigations.state === "invalid" && <p className="wb-warning" role="alert">investigations.json was not used: {data.investigations.reason}. Areas come from the release's labels instead.</p>}
    <div className="wb-body wb-insets-body">
      {data ? <AreaBrowser areas={data.areas} filter={filter} onFilter={setFilter} selected={area?.id} onSelect={next => chooseArea(next)} gaps={checks?.verified ? gaps : undefined}
        ordered={data.investigations.state === "loaded" ? "worklist priority" : "issues first, then reachable unnamed areas, then size"} />
        : <nav className="wb-units" aria-label="Areas"><p className="wb-list-heading" role="status">{error ? "Unavailable" : "Loading areas…"}</p></nav>}
      <section className="wb-map wb-insets-map" aria-label="Map">
        {insetPin ? assets && <Suspense fallback={<div className="route-map" role="status">Loading inset map…</div>}>
          <InsetMap assets={assets} areaPicker={false} overlay={overlay || undefined} style={style} insets onPick={onPick} onFallback={() => {}}
            onSelectFeatures={onSelectFeatures} onRoutingCrossing={routing.selectCrossing} keepView fitAnchors={false} fitSelection={false}
            initialCentre={state.at ?? LUMBRIDGE} focusRegions={focusRegions} focusTile={focusTile} focusBox={focusBox}
            onPlane={(_, next) => choosePlane(next)} onView={() => { const at = mapRef.current?.centreTile(); if (at) update({ at }); }}
            onReady={instance => { mapRef.current = instance; }} />
        </Suspense> : <p className="wb-message">Insets are not available for these map tiles.</p>}
        {area && <div className="wb-map-tools">
          {area.planes.length > 1 && <div className="map-style-toggle" role="group" aria-label="Plane shown">
            {area.planes.map(other => <button key={other} type="button" aria-pressed={other === plane} onClick={() => choosePlane(other)}>Plane {other}</button>)}
          </div>}
          <div className="map-style-toggle" role="group" aria-label="Placement">
            <button type="button" aria-pressed={!state.beside} onClick={() => update({ beside: undefined })} title="Each region where it really is in the world">Real position</button>
            <button type="button" aria-pressed={!!state.beside} onClick={() => update({ beside: true })} title="Beside its entrance, as the planner shows it, where one is known">Beside entrance</button>
          </div>
        </div>}
        {insetPin && styles.length > 1 && <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
          {styles.map(([id, { label }]) => <button key={id} type="button" aria-pressed={style === id} onClick={() => { setStyle(id); saveStyle(id); }}>{label}</button>)}
        </div>}
        <div className="wb-tilebar" role="status" aria-label="Inspected tile">
          {picking ? `Click the map to choose the ${picking === "seed" ? "seed tile" : picking === "anchor" ? "anchor point" : picking}.`
            : inspected ? <><span className="wb-mono">{inspected.x} {inspected.y} {inspected.plane}</span> · {classify(inspected) === "main-world" ? "main map" : <span className="wb-mono">{classify(inspected)}</span>}</>
            : "Click terrain to inspect a tile and select its region."}
          {unanchored && <span className="wb-placement"> · {selectedRegion.id}: placement unknown — shown at its real coordinates, joined to nothing</span>}
        </div>
      </section>
      <aside className="wb-side-panel" aria-label="Details">
        {area && data ? <>
          <div className="wb-panel-head">
            <h2>{area.name}</h2>
            <div className="map-style-toggle wb-modes" role="tablist" aria-label="Mode">
              {(["topology", "labelling"] as const).map(mode => <button key={mode} type="button" role="tab" aria-selected={state.mode === mode} aria-pressed={state.mode === mode}
                onClick={() => update({ mode })}>{mode === "topology" ? "Topology" : "Labelling"}</button>)}
            </div>
            {selectedRegion && <p className="wb-note">Region <span className="wb-mono">{selectedRegion.id}</span> · plane {selectedRegion.plane} · {selectedRegion.tileCount.toLocaleString()} tiles · bounds <span className="wb-mono">{selectedRegion.bounds.join(", ")}</span></p>}
          </div>
          {routing.panel}
          {state.mode === "topology"
            ? <TopologyPanel data={data} area={area} state={topologyState} checks={checks} topology={topology} candidate={candidate} item={state.item}
              plugin={meta?.plugin} releasePlugin={data.plugin} transports={transports} nearby={nearby?.transports} classify={classify} collision={collisionReady ? collision : undefined}
              draft={draft} onDraft={setDraft} picking={picking} onPicking={setPicking} onItem={item => update({ item })} onShow={showPoint}
              onBox={target => setFocusBox({ ...target })} />
            : <LabellingPanel data={data} area={area} region={state.region} item={state.item} plugin={data.plugin ?? meta?.plugin} onItem={item => update({ item })}
              onShow={showPoint} onRegion={chooseRegion} onArea={id => { const next = data.byId.get(id); if (next) chooseArea(next); }}
              correction={correction} onCorrection={setCorrection} picking={picking} onPicking={setPicking} shows={point => !!mapRef.current?.shows(point)} />}
        </> : <>{routing.panel}<div className="wb-panel-body"><p className="wb-note">Choose an area to investigate. Areas with outstanding issues come first; provisional ones are regions nobody has named.</p>
          {data && <p className="wb-note">{data.investigations.state === "loaded" ? "Worklist: investigations.json." : `${data.investigations.reason}`}</p>}
          <p className="wb-note">Topology: {topologyState.state === "loaded" ? `report by ${topologyState.report.generator.repository}@${topologyState.report.generator.rev.slice(0, 7)}` : topologyState.state === "loading" ? "loading…" : topologyState.reason}</p></div></>}
      </aside>
    </div>
    <footer className="wb-footer wb-provenance">
      {lines.map(line => <span key={line.subject} className={`wb-prov ${line.status}`}><b>{line.subject}</b> {line.text}</span>)}
      <span className={`wb-prov ${topologyState.state === "loaded" ? checks?.verified ? "ok" : "differs" : "unknown"}`}><b>Topology</b> {topologyState.state === "loaded"
        ? `${topologyState.report.generator.repository.split("/").at(-1)}@${topologyState.report.generator.rev.slice(0, 7)}, cache ${topologyState.report.collision.cacheId}${checks?.verified ? "" : " — unverified against this page"}`
        : topologyState.state === "loading" ? "loading" : "unavailable"}</span>
      {routing.provenance && <span className="wb-prov ok"><b>Routing</b> {routing.provenance}, verified against these tiles</span>}
    </footer>
  </div>;
}


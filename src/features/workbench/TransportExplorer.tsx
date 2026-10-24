import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapLayer, type MapStyle } from "../../map/layers";
import { CollisionMap, releaseTiles } from "../../map/insets/collision";
import { COLLISION_RADIUS } from "../../map/insets/composition";
import { LayerControl, toggleLayer, type MapLayerEntry } from "../../map/insets/LayerControl";
import type { WorldBox } from "../../map/insets/projection";
import { TONES } from "../../map/insets/routeStyles";
import { bankFeatures, bankKey, bankOf, loadBanks, type Bank, type Banks } from "./banks";
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { useRoutingLayers } from "./RoutingPanel";
import { EXPLORER_LAYERS, FAMILIES, loadDetail, loadMeta, loadView, parseTile, readState, searchTransports, sourceUrl, stationOf, toneOf, toneOfType,
  TRANSPORTS_MAX_RESOLUTION, typeName, viewOverlay, writeState, type ExplorerState, type TransportDetail, type TransportMeta, type TransportNetwork,
  type TransportSummary, type TransportView } from "./transports";
import "./workbench.css";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));

const point = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "anywhere";
const LUMBRIDGE = { point: { x: 3222, y: 3218, plane: 0 }, zoom: 8 };
/** Listed in the side panel at most; the map shows all of them. */
const LISTED = 200;

function TypeSwatch({ type, teleport }: { type: string; teleport: boolean }) {
  return <i className="wb-swatch" style={{ background: TONES[toneOf({ type, teleport })] }} />;
}

/** One row of the list: a transport, or several the same in all but their requirements. */
function SummaryButton({ group, selected, onSelect }: { group: TransportSummary[]; selected: boolean; onSelect(): void }) {
  const summary = group[0];
  return <button type="button" aria-current={selected} onClick={onSelect}>
    <span className="wb-unit-title"><TypeSwatch type={summary.type} teleport={summary.teleport} />{summary.label || typeName(summary.type)}
      {group.length > 1 && <small className="wb-count" title={`${group.length} transports with these ends, differing in what they need`}>×{group.length}</small>}</span>
    <span className="wb-unit-meta">{point(summary.origin)} → {point(summary.destination)}</span>
  </button>;
}

/** Transports with the same label, type and ends: listed once. */
function grouped(list: TransportSummary[]) {
  const groups = new Map<string, TransportSummary[]>();
  for (const summary of list) {
    const key = [summary.label, summary.type, point(summary.origin), point(summary.destination)].join("|");
    groups.set(key, [...groups.get(key) || [], summary]);
  }
  return [...groups.values()];
}

function Detail({ detail, meta, onShow }: { detail: TransportDetail; meta?: TransportMeta; onShow(point: WorldPoint): void }) {
  const tile = (p: WorldPoint | null) => p ? <button type="button" className="wb-tile" title="Show on the map" onClick={() => onShow(p)}>{point(p)}</button> : <i>anywhere</i>;
  const needs = [...detail.requirements.map(requirement => <span key={requirement.kind + requirement.name} className={`wb-chip ${requirement.kind}`}>{requirement.name}</span>),
    ...detail.varChecks.map(check => <span key={check} className="wb-chip var">{check}</span>)];
  return <section className="wb-detail" aria-label="Transport">
    <h2><TypeSwatch type={detail.type} teleport={detail.teleport} />{detail.label || typeName(detail.type)} <small>{typeName(detail.type)}</small></h2>
    <dl className="wb-facts">
      <dt>From → to</dt><dd className="wb-mono">{tile(detail.origin)} → {tile(detail.destination)}
        {detail.remappedFrom && <span className="wb-note"> (row says {point(detail.remappedFrom)}; moved to the house landing)</span>}</dd>
      {detail.objectInfo && <><dt>Action</dt><dd>{detail.objectInfo}</dd></>}
      <dt>Takes</dt><dd>{detail.duration} ticks{detail.consumable ? " · consumable" : ""}{detail.maxWildernessLevel >= 0 ? ` · wilderness ≤ ${detail.maxWildernessLevel}` : ""}</dd>
      <dt>Needs</dt><dd>{needs.length ? needs : "nothing"}</dd>
      <dt>{detail.sources.length === 1 ? "Row" : "Rows"}</dt><dd>{detail.sources.length ? detail.sources.map(source =>
        <details key={source.role + source.line} className="wb-source">
          <summary><a href={meta ? sourceUrl(meta.plugin, source) : undefined} target="_blank" rel="noreferrer">{source.file.split("/").at(-1)}:{source.line}</a>
            {source.role !== "row" && ` (${source.role})`}{source.section && <span className="wb-note"> · {source.section}</span>}</summary>
          <div className="wb-details">{Object.entries(source.fields).filter(([, value]) => value).map(([name, value]) => <span key={name}><b>{name}</b> {value}</span>)}</div>
        </details>) : "no source row matched"}</dd>
    </dl>
    <p className="wb-legend" aria-label="Collision legend" title="The pathfinder's collision around this transport's ends, when zoomed in">
      Collision: <span className="wb-key boundary" /> edge of walkable ground <span className="wb-key wall" /> wall or door <span className="wb-key edge" /> closed by an object
    </p>
  </section>;
}

function BankDetail({ bank, onShow }: { bank: Bank; onShow(point: WorldPoint): void }) {
  return <section className="wb-detail" aria-label="Bank">
    <h2><i className="wb-swatch" style={{ background: TONES.bank }} />{bank.name || "Bank"} <small>Bank</small></h2>
    <dl className="wb-facts">
      <dt>{bank.tiles.length === 1 ? "Tile" : "Tiles"}</dt><dd className="wb-mono">{bank.tiles.map(tile =>
        <button key={point(tile)} type="button" className="wb-tile" title="Show on the map" onClick={() => onShow(tile)}>{point(tile)}</button>)}</dd>
      <dt>Needs</dt><dd>{bank.needs.length ? bank.needs.map(need => <span key={need.kind + need.name} className={`wb-chip ${need.kind}`}>{need.name}</span>) : "nothing"}</dd>
    </dl>
  </section>;
}

export function TransportExplorer() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<ExplorerState>(() => readState(location.search));
  const update = (next: Partial<ExplorerState>) => setState(current => ({ ...current, ...next }));
  // The URL follows the state, so a link opens the same transport, place and filters.
  useEffect(() => {
    const search = writeState(state);
    if (search !== location.search) navigate({ search }, { replace: true });
  }, [state]);
  useEffect(() => { document.title = "Transport explorer · Workbench"; }, []);

  const [meta, setMeta] = useState<TransportMeta>();
  const [collisionManifest, setCollisionManifest] = useState<CollisionManifest>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    loadMeta(abort.signal).then(setMeta, reason => { if (!abort.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    loadCollisionManifest(abort.signal).then(setCollisionManifest, () => {});
    return () => abort.abort();
  }, []);

  // The transports in view: asked for after each move, a box per area drawn, when zoomed in far
  // enough to tell them apart.
  const [boxes, setBoxes] = useState<WorldBox[]>();
  const [zoomedOut, setZoomedOut] = useState(false);
  const [view, setView] = useState<TransportView>();
  const [loading, setLoading] = useState(false);
  const typesKey = state.types?.join(",");
  const shownLayers = state.layers ?? ["transports"];
  const transportsOn = shownLayers.includes("transports");
  const banksOn = shownLayers.includes("banks");
  // The banks: every one, once the layer is first switched on.
  const [banks, setBanks] = useState<Banks>();
  const [bankError, setBankError] = useState("");
  useEffect(() => {
    if (!banksOn || banks) return;
    const abort = new AbortController();
    loadBanks(abort.signal).then(setBanks, reason => { if (!abort.signal.aborted) setBankError(String(reason instanceof Error ? reason.message : reason)); });
    return () => abort.abort();
  }, [banksOn, banks]);
  const [bank, setBank] = useState<Bank>();
  useEffect(() => {
    if (!transportsOn || zoomedOut) { setView(undefined); setViewBoxes(undefined); setLoading(false); return; }
    if (!boxes) return;
    if (!boxes.length) { setView({ total: 0, transports: [] }); setViewBoxes([]); return; }
    const abort = new AbortController();
    setLoading(true);
    loadView(boxes, state.types, abort.signal).then(loaded => { setView(loaded); setViewBoxes(boxes); setLoading(false); },
      reason => { if (!abort.signal.aborted) { setError(String(reason instanceof Error ? reason.message : reason)); setLoading(false); } });
    return () => abort.abort();
  }, [boxes, typesKey, transportsOn, zoomedOut]);

  const [detail, setDetail] = useState<TransportDetail>();
  useEffect(() => {
    if (!state.selected) { setDetail(undefined); return; }
    const abort = new AbortController();
    loadDetail(state.selected, abort.signal).then(setDetail,
      reason => { if (!abort.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => abort.abort();
  }, [state.selected]);

  // Collision around the selected transport's tiles.
  const collision = useMemo(() => new CollisionMap(releaseTiles(tiles.base, tiles.version)), []);
  const [collisionFor, setCollisionFor] = useState<string>();
  useEffect(() => {
    if (!detail) return;
    const abort = new AbortController();
    const ends = [detail.origin, detail.destination].filter((p): p is WorldPoint => !!p);
    void collision.load(ends, COLLISION_RADIUS + 1, abort.signal).then(() => { if (!abort.signal.aborted) setCollisionFor(detail.id); });
    return () => abort.abort();
  }, [detail, collision]);

  const selected = detail?.id === state.selected ? detail : undefined;
  // Drawn against the boxes the view was asked for, so features never outrun the data behind them.
  const [viewBoxes, setViewBoxes] = useState<WorldBox[]>();
  // A network picked by its hub or a spoke: its stations are listed.
  const [network, setNetwork] = useState<TransportNetwork>();
  const transportOverlay = useMemo(() => {
    const drawn = viewOverlay(view, selected, collisionFor === selected?.id ? collision : undefined, viewBoxes, network?.id, state.hubs !== false);
    // Banks under the transports, drawn on their tiles like them, and only as close.
    const banked = banksOn && banks && boxes && !zoomedOut ? bankFeatures(banks.banks, boxes) : [];
    return { ...drawn, features: [...banked, ...drawn.features], selected: drawn.selected ?? (bank && bankKey(bank.id)) };
  }, [view, selected, collisionFor, collision, viewBoxes, network, banksOn, banks, boxes, zoomedOut, bank, state.hubs]);

  // A selection from the list, a search or a link brings it into view; one picked on the map doesn't.
  // A link that names a place opens there, not on its transport.
  const fitNext = useRef(!state.at);
  const select = (id: string | undefined, fit: boolean) => { fitNext.current = fit; update({ selected: id }); };
  // From the list: the map moves only when the transport isn't already in view.
  const choose = (summary: TransportSummary) => {
    const ends = [summary.origin, summary.destination].filter((p): p is WorldPoint => !!p);
    const inView = ends.every(p => viewBoxes?.some(box => p.plane === box.plane && p.x >= box.x1 && p.x <= box.x2 && p.y >= box.y1 && p.y <= box.y2));
    select(summary.id, !inView);
  };
  // A tile clicked on the map: every transport arriving at or leaving it, and those under the click.
  const [here, setHere] = useState<{ tile: WorldPoint; keys: string[]; transports?: TransportSummary[] }>();
  const [focusBox, setFocusBox] = useState<WorldBox>();
  // A tile clicked on the map, for the routing layers to inspect.
  const [picked, setPicked] = useState<WorldPoint>();
  const routing = useRoutingLayers(picked, setFocusBox, shownLayers);
  const overlay = useMemo(() => transportOverlay && { ...transportOverlay, routing: routing.overlay }, [transportOverlay, routing.overlay]);
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  const onSelectFeatures = (keys: string[], point?: WorldPoint) => {
    // A station's tiles stand for every transport there: the tile is looked at.
    const station = keys.map(stationOf).find(Boolean);
    const transports = keys.filter(key => !key.includes(":"));
    const hub = keys.find(key => key.startsWith("network:"));
    const banked = keys.map(key => bankOf(banks?.banks, key)).find(Boolean);
    setBank(!transports.length && !station ? banked : undefined);
    if (banked && !transports.length && !station) { setNetwork(undefined); setHere(undefined); select(undefined, false); return; }
    if (!station && !transports.length && hub) {
      const picked = view?.networks?.find(each => `network:${each.id}` === hub);
      if (picked) { setNetwork(picked); setHere(undefined); select(undefined, false); }
      return;
    }
    setNetwork(undefined);
    if (station || point) lookAt(station ?? point!, transports);
    if (transports.length === 1) select(transports[0], false);
  };
  const lookAt = (tile: WorldPoint, keys: string[] = []) => {
    setPicked(tile);
    setHere({ tile, keys });
    const at = (p: WorldPoint | null) => !!p && p.x === tile.x && p.y === tile.y && p.plane === tile.plane;
    loadView([{ plane: tile.plane, x1: tile.x, y1: tile.y, x2: tile.x, y2: tile.y }], state.types).then(found => {
      const transports = found.transports.filter(summary => at(summary.origin) || at(summary.destination));
      setHere(current => current?.tile === tile ? { ...current, transports } : current);
    }, reason => setError(String(reason instanceof Error ? reason.message : reason)));
  };

  const [query, setQuery] = useState(state.query || "");
  const [results, setResults] = useState<TransportSummary[]>();
  const runSearch = (text: string) => {
    const tile = parseTile(text);
    if (tile) {
      setFocusBox({ plane: tile.plane, x1: tile.x - 10, y1: tile.y - 10, x2: tile.x + 10, y2: tile.y + 10 });
      update({ query: text, at: { point: tile, zoom: 9 } });
    } else update({ query: text || undefined });
    if (!text.trim()) { setResults(undefined); return; }
    searchTransports(text, state.types).then(setResults, reason => setError(String(reason instanceof Error ? reason.message : reason)));
  };
  useEffect(() => { if (state.query) runSearch(state.query); }, []);
  const submit = (event: FormEvent) => { event.preventDefault(); runSearch(query); };

  const [style, setStyle] = useState(savedStyle);
  const styles = Object.entries(mapLayers) as [MapStyle, MapLayer][];
  const shownTypes = new Set(state.types ?? meta?.types.map(type => type.type) ?? []);
  const toggleType = (type: string) => {
    const all = meta?.types.map(other => other.type) || [];
    const next = shownTypes.has(type) ? [...shownTypes].filter(other => other !== type) : [...shownTypes, type];
    update({ types: next.length === all.length ? undefined : all.filter(other => next.includes(other)) });
  };

  // A family's types all at once; partly shown when only some are.
  const setTypes = (types: string[], on: boolean) => {
    const all = meta?.types.map(other => other.type) || [];
    const next = on ? new Set([...shownTypes, ...types]) : new Set([...shownTypes].filter(type => !types.includes(type)));
    update({ types: next.size === all.length ? undefined : all.filter(other => next.has(other)) });
  };
  const families = <div className="wb-families" role="group" aria-label="Transport families">
    {FAMILIES.map(family => {
      const types = meta?.types.filter(type => toneOfType(type) === family.tone).map(type => type.type) || [];
      const shown = types.filter(type => shownTypes.has(type)).length;
      return <label key={family.tone}>
        <input type="checkbox" checked={!!types.length && shown === types.length} disabled={!types.length}
          ref={input => { if (input) input.indeterminate = shown > 0 && shown < types.length; }}
          onChange={event => setTypes(types, event.target.checked)} />
        <i className="wb-swatch" style={{ background: TONES[family.tone] }} />{family.label}
      </label>;
    })}
    <label title="Join each network station to its network's hub">
      <input type="checkbox" checked={state.hubs !== false} onChange={event => update({ hubs: event.target.checked ? undefined : false })} />
      Network hubs
    </label>
  </div>;
  const typeFilter = <>{families}<details className="wb-filters">
    <summary>Types {state.types ? `(${state.types.length} of ${meta?.types.length ?? "?"})` : "(all)"}</summary>
    <div className="wb-filter-actions">
      <button type="button" onClick={() => update({ types: undefined })}>All</button>
      <button type="button" onClick={() => update({ types: [] })}>None</button>
    </div>
    {meta?.types.map(type => <label key={type.type}>
      <input type="checkbox" checked={shownTypes.has(type.type)} onChange={() => toggleType(type.type)} />
      <i className="wb-swatch" style={{ background: TONES[toneOfType(type)] }} />{typeName(type.type)} <small>{type.count}</small>
    </label>)}
  </details></>;
  const layers: MapLayerEntry[] = [
    { id: "transports", label: "Transports", swatch: `linear-gradient(90deg, ${TONES.object} 33%, ${TONES.journey} 33% 66%, ${TONES.teleport} 66%)`, on: transportsOn, options: typeFilter,
      status: zoomedOut ? "Zoom in to see transports" : undefined,
      title: "Every effective transport with an end in view, drawn on its tiles once zoomed in far enough to tell them apart" },
    { id: "banks", label: "Banks", swatch: TONES.bank, on: banksOn,
      status: bankError || (zoomedOut ? "Zoom in to see banks" : !banks ? "Loading…" : undefined),
      title: "The plugin's bank tiles: filled where anyone can bank, outlined where it needs a quest, skill or unlock first" },
    ...routing.layers,
  ];
  const toggle = (id: string, on: boolean) => {
    const next = toggleLayer(shownLayers, id, on, EXPLORER_LAYERS);
    update({ layers: next.join(",") === "transports" ? undefined : next });
  };

  const listed = (results ?? view?.transports) || [];
  const groups = useMemo(() => grouped(listed), [listed]);
  // At a clicked tile: what arrives, what leaves, and what was under the click besides.
  const atTile = useMemo(() => {
    if (!here?.transports) return undefined;
    const same = (p: WorldPoint | null) => !!p && p.x === here.tile.x && p.y === here.tile.y && p.plane === here.tile.plane;
    const known = new Set(here.transports.map(summary => summary.id));
    return {
      arriving: grouped(here.transports.filter(summary => same(summary.destination))),
      leaving: grouped(here.transports.filter(summary => same(summary.origin) && !same(summary.destination))),
      under: grouped(view?.transports.filter(summary => here.keys.includes(summary.id) && !known.has(summary.id)) || []),
    };
  }, [here, view]);
  const shownGroups = atTile ? [...atTile.arriving, ...atTile.leaving, ...atTile.under] : groups;
  const lines = provenance(meta, collisionManifest);
  const mapRef = useRef<{ centreTile(): { point: WorldPoint; zoom: number } }>(undefined);
  // After each move: what's in view, and where the map is (for the URL).
  const recordView = (inView: WorldBox[], resolution: number) => {
    setBoxes(inView);
    setZoomedOut(resolution > TRANSPORTS_MAX_RESOLUTION);
    const at = mapRef.current?.centreTile();
    if (at) update({ at });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || !shownGroups.length) return;
      const index = shownGroups.findIndex(group => group.some(summary => summary.id === state.selected));
      const next = event.key === "j" ? shownGroups[Math.min(index + 1, shownGroups.length - 1)] : event.key === "k" ? shownGroups[Math.max(index - 1, 0)] : undefined;
      if (next) choose(next[0]);
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [shownGroups, state.selected]);

  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link>
      <span className="wb-tool">Transport explorer</span>
      {meta && <span className="wb-summary">{meta.total.toLocaleString()} effective transports</span>}
      <span className="wb-keys"><kbd>j</kbd>/<kbd>k</kbd> next/previous</span>
    </header>
    {error && <p className="wb-warning" role="alert">{error}</p>}
    <div className="wb-body">
      <nav className="wb-units wb-explorer-side" aria-label="Transports">
        <form className="wb-search" onSubmit={submit} role="search">
          <input aria-label="Search transports" placeholder="Object id, x y plane, or text" value={query} onChange={event => setQuery(event.target.value)} />
          <button type="submit">Find</button>
        </form>
        {network && !here ? <>
          <p className="wb-list-heading" role="status">{network.name} <small>{network.stations.length} stations</small>{" "}
            <button type="button" className="wb-link" onClick={() => setNetwork(undefined)}>back to all in view</button></p>
          <ol>{network.stations.map(({ point: station, name }) => <li key={point(station)}>
            <button type="button" onClick={() => { setNetwork(undefined); setFocusBox({ plane: station.plane, x1: station.x - 8, y1: station.y - 8, x2: station.x + 8, y2: station.y + 8 }); lookAt(station); }}>
              <span className="wb-unit-title"><TypeSwatch type={network.type} teleport={false} />{name || "Station"}</span>
              <span className="wb-unit-meta">{point(station)}</span>
            </button>
          </li>)}</ol>
        </> : here ? <>
          <p className="wb-list-heading" role="status">At <span className="wb-mono">{point(here.tile)}</span>{" "}
            <button type="button" className="wb-link" onClick={() => setHere(undefined)}>back to all in view</button></p>
          {!atTile ? <p className="wb-note" role="status">Loading…</p> : <>
            {([["Arriving here", atTile.arriving], ["Leaving here", atTile.leaving], ["Under the click", atTile.under]] as const)
              .filter(([, list]) => list.length).map(([title, list]) => <section key={title} aria-label={title}>
                <h3 className="wb-list-section">{title} <small>{list.reduce((n, group) => n + group.length, 0)}</small></h3>
                <ol>{list.map(group => <li key={group[0].id}>
                  <SummaryButton group={group} selected={group.some(summary => summary.id === state.selected)} onSelect={() => choose(group[0])} />
                </li>)}</ol>
              </section>)}
            {!atTile.arriving.length && !atTile.leaving.length && !atTile.under.length && <p className="wb-note">No transport arrives at or leaves this tile.</p>}
          </>}
        </> : <>
          <p className="wb-list-heading" role="status">{results ? <>{results.length}{results.length === 50 ? "+" : ""} found for “{state.query}” <button type="button" className="wb-link" onClick={() => { setResults(undefined); setQuery(""); update({ query: undefined }); }}>clear</button></>
            : !transportsOn ? "The transports layer is off." : zoomedOut ? "Zoom in to see transports." : !view ? "Loading…"
            : view.transports.length < view.total ? `${view.total.toLocaleString()} in view; zoom in to list them`
            : `${view.total} in view${loading ? " (updating…)" : ""}`}</p>
          <ol>{groups.slice(0, LISTED).map(group => <li key={group[0].id}>
            <SummaryButton group={group} selected={group.some(summary => summary.id === state.selected)} onSelect={() => choose(group[0])} />
          </li>)}</ol>
          {groups.length > LISTED && <p className="wb-note">and {groups.length - LISTED} more on the map</p>}
        </>}
      </nav>
      <main className="wb-main">
        <section className="wb-map">
          {insetPin ? <Suspense fallback={<div className="route-map" role="status">Loading inset map…</div>}>
            <InsetMap overlay={overlay} style={style} insets keepFocus onPick={point => lookAt(point)}
              onRoutingCrossing={routing.selectCrossing} onFallback={() => {}}
              onSelectFeatures={onSelectFeatures} onView={recordView} fitSelection={false} fitAnchors={fitNext.current}
              initialCentre={state.at ?? LUMBRIDGE} focusBox={focusBox} focusTile={focusTile}
              onReady={instance => { mapRef.current = instance; }} />
          </Suspense> : <p className="wb-message">Insets are not available for these map tiles.</p>}
          {insetPin && styles.length > 1 && <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {styles.map(([id, { label }]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id); saveStyle(id); }}>{label}</button>)}
          </div>}
          {insetPin && <LayerControl layers={layers} onToggle={toggle} />}
        </section>
        <div className="wb-below-map">
          {bank && !selected ? <BankDetail bank={bank} onShow={p => setFocusTile({ point: p })} />
            : selected ? <Detail detail={selected} meta={meta} onShow={p => setFocusTile({ point: p })} />
            : <section className="wb-detail wb-hint-panel"><p className="wb-note">Click a tile to see every transport arriving there or leaving it, or a transport for its details.</p></section>}
          {routing.panel && <div className="wb-detail">{routing.panel}</div>}
        </div>
      </main>
    </div>
    <footer className="wb-footer wb-provenance">
      {lines.map(line => <span key={line.subject} className={`wb-prov ${line.status}`} title={line.text}><b>{line.subject}</b> {line.label}</span>)}
      {routing.provenance && <span className="wb-prov ok" title="Verified against these tiles"><b>Routing</b> {routing.provenance}</span>}
    </footer>
  </div>;
}

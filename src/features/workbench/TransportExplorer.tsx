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
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { useRoutingLayers } from "./RoutingPanel";
import { clusterKey, EXPLORER_LAYERS, loadDetail, loadMeta, loadView, parseTile, readState, searchTransports, sourceUrl, toneOf, toneOfType,
  typeName, viewOverlay, writeState, type ExplorerState, type TransportDetail, type TransportMeta, type TransportSummary,
  type TransportView } from "./transports";
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

  // The transports in view: asked for after each move, a box per area drawn.
  const [boxes, setBoxes] = useState<WorldBox[]>();
  const [view, setView] = useState<TransportView>();
  const [loading, setLoading] = useState(false);
  const typesKey = state.types?.join(",");
  const shownLayers = state.layers ?? ["transports"];
  const transportsOn = shownLayers.includes("transports");
  useEffect(() => {
    if (!transportsOn) { setView(undefined); setViewBoxes(undefined); setLoading(false); return; }
    if (!boxes) return;
    if (!boxes.length) { setView({ total: 0, transports: [], clusters: [] }); setViewBoxes([]); return; }
    const abort = new AbortController();
    setLoading(true);
    loadView(boxes, state.types, abort.signal).then(loaded => { setView(loaded); setViewBoxes(boxes); setLoading(false); },
      reason => { if (!abort.signal.aborted) { setError(String(reason instanceof Error ? reason.message : reason)); setLoading(false); } });
    return () => abort.abort();
  }, [boxes, typesKey, transportsOn]);

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
  const transportOverlay = useMemo(() => viewOverlay(view, selected, collisionFor === selected?.id ? collision : undefined, viewBoxes),
    [view, selected, collisionFor, collision, viewBoxes]);

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
    const cluster = keys.find(key => key.startsWith("cluster:"));
    if (cluster) {
      const counted = view?.clusters[Number(cluster.slice(8))];
      if (counted) setFocusBox({ plane: counted.plane, x1: counted.x1 - 4, y1: counted.y1 - 4, x2: counted.x2 + 4, y2: counted.y2 + 4 });
      return;
    }
    if (point) lookAt(point, keys);
    if (keys.length === 1) select(keys[0], false);
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

  const typeFilter = <details className="wb-filters">
    <summary>Types {state.types ? `(${state.types.length} of ${meta?.types.length ?? "?"})` : "(all)"}</summary>
    <div className="wb-filter-actions">
      <button type="button" onClick={() => update({ types: undefined })}>All</button>
      <button type="button" onClick={() => update({ types: [] })}>None</button>
    </div>
    {meta?.types.map(type => <label key={type.type}>
      <input type="checkbox" checked={shownTypes.has(type.type)} onChange={() => toggleType(type.type)} />
      <i className="wb-swatch" style={{ background: TONES[toneOfType(type)] }} />{typeName(type.type)} <small>{type.count}</small>
    </label>)}
  </details>;
  const layers: MapLayerEntry[] = [
    { id: "transports", label: "Transports", swatch: `linear-gradient(90deg, ${TONES.object} 33%, ${TONES.journey} 33% 66%, ${TONES.teleport} 66%)`, on: transportsOn, options: typeFilter,
      title: "Every effective transport with an end in view: listed and drawn when few enough, else counted where they are" },
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
  const recordView = (inView: WorldBox[]) => {
    setBoxes(inView);
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
        {here ? <>
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
            : !transportsOn ? "The transports layer is off." : !view ? "Loading…" : view.clusters.length ? `${view.total.toLocaleString()} in view; zoom in to list them`
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
            <InsetMap overlay={overlay} style={style} insets onPick={point => lookAt(point)}
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
          {selected ? <Detail detail={selected} meta={meta} onShow={p => setFocusTile({ point: p })} />
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

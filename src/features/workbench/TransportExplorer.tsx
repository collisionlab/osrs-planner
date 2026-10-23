import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapLayer, type MapStyle } from "../../map/layers";
import { CollisionMap, releaseTiles } from "../../map/insets/collision";
import { COLLISION_RADIUS } from "../../map/insets/composition";
import type { WorldBox } from "../../map/insets/projection";
import { TONES } from "../../map/insets/routeStyles";
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { clusterKey, loadDetail, loadMeta, loadView, parseTile, readState, searchTransports, sourceUrl, toneOf, toneOfType,
  typeName, viewOverlay, writeState, type ExplorerState, type TransportDetail, type TransportMeta, type TransportSummary,
  type TransportView } from "./transports";
import "./workbench.css";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));

const point = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "anywhere";
const LUMBRIDGE = { point: { x: 3222, y: 3218, plane: 0 }, zoom: 8 };
/** Listed in the side panel at most; the map shows all of them. */
const LISTED = 200;
const CONSTRUCTION: Record<TransportSummary["construction"], string> = {
  row: "One row", paired: "Paired: an origin row with a destination row", teleport: "Teleport: usable from anywhere",
};

function TypeSwatch({ type, teleport }: { type: string; teleport: boolean }) {
  return <i className="wb-swatch" style={{ background: TONES[toneOf({ type, teleport })] }} />;
}

function SummaryButton({ summary, selected, onSelect }: { summary: TransportSummary; selected: boolean; onSelect(): void }) {
  return <button type="button" aria-current={selected} onClick={onSelect}>
    <span className="wb-unit-title"><TypeSwatch type={summary.type} teleport={summary.teleport} />{summary.label || typeName(summary.type)}</span>
    <span className="wb-unit-meta"><span>{point(summary.origin)} → {point(summary.destination)}</span><span>{typeName(summary.type)}</span></span>
  </button>;
}

function Detail({ detail, meta, onShow }: { detail: TransportDetail; meta?: TransportMeta; onShow(point: WorldPoint): void }) {
  const tile = (p: WorldPoint | null) => p ? <button type="button" className="wb-tile" title="Show on the map" onClick={() => onShow(p)}>{point(p)}</button> : <i>anywhere</i>;
  return <section className="wb-detail" aria-label="Transport">
    <h2><TypeSwatch type={detail.type} teleport={detail.teleport} />{detail.label || typeName(detail.type)} <small>{typeName(detail.type)} · {detail.id}</small></h2>
    <div className="wb-columns">
      <div>
        <h3>Effective transport <small>as the plugin builds it</small></h3>
        <dl className="wb-facts">
          <dt>From</dt><dd className="wb-mono">{tile(detail.origin)}</dd>
          <dt>To</dt><dd className="wb-mono">{tile(detail.destination)}{detail.remappedFrom && <span className="wb-note"> (the row says {point(detail.remappedFrom)}; the plugin moves house destinations to its landing tile)</span>}</dd>
          <dt>Built from</dt><dd>{CONSTRUCTION[detail.construction]}</dd>
          {detail.objectInfo && <><dt>Action</dt><dd>{detail.objectInfo}</dd></>}
          {detail.displayInfo && <><dt>Display info</dt><dd>{detail.displayInfo}</dd></>}
          <dt>Duration</dt><dd>{detail.duration} ticks{detail.consumable ? " · consumable" : ""}{detail.maxWildernessLevel >= 0 ? ` · up to wilderness level ${detail.maxWildernessLevel}` : ""}</dd>
          <dt>Requirements</dt><dd>{detail.requirements.length || detail.varChecks.length
            ? <>{detail.requirements.map(requirement => <span key={requirement.kind + requirement.name} className={`wb-chip ${requirement.kind}`}>{requirement.name}</span>)}
              {detail.varChecks.map(check => <span key={check} className="wb-chip var">{check}</span>)}</> : "none"}</dd>
        </dl>
      </div>
      <div>
        <h3>Source rows <small>as written</small></h3>
        {detail.sources.length ? <table className="wb-rows wb-sources">
          <thead><tr><th>Row</th><th>Columns</th></tr></thead>
          <tbody>{detail.sources.map(source => <tr key={source.role + source.line}>
            <td className="wb-mono">{source.role !== "row" && <b>{source.role} </b>}
              <a href={meta ? sourceUrl(meta.plugin, source) : undefined} target="_blank" rel="noreferrer">{source.file.split("/").at(-1)}:{source.line}</a>
              {source.section && <div className="wb-note">{source.section}</div>}</td>
            <td className="wb-details">{Object.entries(source.fields).filter(([, value]) => value).map(([name, value]) => <span key={name}><b>{name}</b> {value}</span>)}</td>
          </tr>)}</tbody>
        </table> : <p className="wb-note">No source row matched this transport.</p>}
      </div>
    </div>
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
  useEffect(() => {
    if (!boxes) return;
    if (!boxes.length) { setView({ total: 0, transports: [], clusters: [] }); setViewBoxes([]); return; }
    const abort = new AbortController();
    setLoading(true);
    loadView(boxes, state.types, abort.signal).then(loaded => { setView(loaded); setViewBoxes(boxes); setLoading(false); },
      reason => { if (!abort.signal.aborted) { setError(String(reason instanceof Error ? reason.message : reason)); setLoading(false); } });
    return () => abort.abort();
  }, [boxes, typesKey]);

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
  const overlay = useMemo(() => viewOverlay(view, selected, collisionFor === selected?.id ? collision : undefined, viewBoxes),
    [view, selected, collisionFor, collision, viewBoxes]);

  // A selection from the list, a search or a link brings it into view; one picked on the map doesn't.
  // A link that names a place opens there, not on its transport.
  const fitNext = useRef(!state.at);
  const select = (id: string | undefined, fit: boolean) => { fitNext.current = fit; update({ selected: id }); };
  const [here, setHere] = useState<{ ids: string[] }>();
  const [focusBox, setFocusBox] = useState<WorldBox>();
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  const onSelectFeatures = (keys: string[]) => {
    const cluster = keys.find(key => key.startsWith("cluster:"));
    if (cluster) {
      const counted = view?.clusters[Number(cluster.slice(8))];
      if (counted) setFocusBox({ plane: counted.plane, x1: counted.x1 - 4, y1: counted.y1 - 4, x2: counted.x2 + 4, y2: counted.y2 + 4 });
      return;
    }
    if (keys.length === 1) { setHere(undefined); select(keys[0], false); return; }
    // Several transports under the click (one tile, many destinations): list them to choose from.
    setHere({ ids: keys });
    select(keys.includes(state.selected || "") ? state.selected : keys[0], false);
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

  const listed = (here ? view?.transports.filter(summary => here.ids.includes(summary.id)) : results ?? view?.transports) || [];
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
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || !listed.length) return;
      const index = listed.findIndex(summary => summary.id === state.selected);
      if (event.key === "j") select(listed[Math.min(index + 1, listed.length - 1)].id, true);
      else if (event.key === "k") select(listed[Math.max(index - 1, 0)].id, true);
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [listed, state.selected]);

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
        <details className="wb-filters">
          <summary>Types {state.types ? `(${state.types.length} of ${meta?.types.length ?? "?"})` : "(all)"}</summary>
          <div className="wb-filter-actions">
            <button type="button" onClick={() => update({ types: undefined })}>All</button>
            <button type="button" onClick={() => update({ types: [] })}>None</button>
          </div>
          {meta?.types.map(type => <label key={type.type}>
            <input type="checkbox" checked={shownTypes.has(type.type)} onChange={() => toggleType(type.type)} />
            <i className="wb-swatch" style={{ background: TONES[toneOfType(type)] }} />{typeName(type.type)} <small>{type.count}</small>
          </label>)}
        </details>
        <p className="wb-list-heading" role="status">{here ? <>{here.ids.length} transports at this spot <button type="button" className="wb-link" onClick={() => setHere(undefined)}>show all in view</button></>
          : results ? <>{results.length}{results.length === 50 ? "+" : ""} found for “{state.query}” <button type="button" className="wb-link" onClick={() => { setResults(undefined); setQuery(""); update({ query: undefined }); }}>clear</button></>
          : !view ? "Loading…" : view.clusters.length ? `${view.total.toLocaleString()} transports in view; zoom in (or click a count) to list them`
          : `${view.total} in view${loading ? " (updating…)" : ""}`}</p>
        <ol>{listed.slice(0, LISTED).map(summary => <li key={summary.id}>
          <SummaryButton summary={summary} selected={summary.id === state.selected} onSelect={() => select(summary.id, true)} />
        </li>)}</ol>
        {listed.length > LISTED && <p className="wb-note">and {listed.length - LISTED} more on the map</p>}
      </nav>
      <main className="wb-main">
        <section className="wb-map">
          {insetPin ? <Suspense fallback={<div className="route-map" role="status">Loading inset map…</div>}>
            <InsetMap overlay={overlay} style={style} insets onPick={() => setHere(undefined)} onFallback={() => {}}
              onSelectFeatures={onSelectFeatures} onView={recordView} fitSelection={false} fitAnchors={fitNext.current}
              initialCentre={state.at ?? LUMBRIDGE} focusBox={focusBox} focusTile={focusTile}
              onReady={instance => { mapRef.current = instance; }} />
          </Suspense> : <p className="wb-message">Insets are not available for these map tiles.</p>}
          {insetPin && styles.length > 1 && <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {styles.map(([id, { label }]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id); saveStyle(id); }}>{label}</button>)}
          </div>}
        </section>
        {selected ? <Detail detail={selected} meta={meta} onShow={p => setFocusTile({ point: p })} />
          : <section className="wb-detail wb-hint-panel"><p className="wb-note">Click a transport on the map or in the list to see where it comes from. Teleports, which leave from anywhere, show only where they land.</p></section>}
      </main>
    </div>
    <footer className="wb-footer wb-provenance">
      {lines.map(line => <span key={line.subject} className={`wb-prov ${line.status}`} title={line.status === "differs" ? "Not made from the same revision" : undefined}>
        <b>{line.subject}</b> {line.text}</span>)}
    </footer>
  </div>;
}

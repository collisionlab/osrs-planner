import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { WorldPoint } from "../../domain/contracts";
import type { FeatureOverlay, MapFeature } from "../../map/insets/features";
import { LayerControl, type MapLayerEntry } from "../../map/insets/LayerControl";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapLayer, type MapStyle } from "../../map/layers";
import type { WorldBox } from "../../map/insets/projection";
import { TONES } from "../../map/insets/routeStyles";
import { caseKey, casesAt, counts, coverageFeatures, COVERAGE_LAYERS, DEFAULT_COVERAGE, expectation, filterCases, loadBenchmarks,
  readBenchmarkState, runBenchmark, worldPoint, writeBenchmarkState, type BenchmarkCase, type BenchmarkIndex, type BenchmarkRun,
  type BenchmarkState } from "./benchmarks";
import { readLayerSettings, writeLayerSettings, type LayerSettings } from "./transports";
import { useWorkbenchLayers } from "./WorkbenchLayers";
import "./workbench.css";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));

const point = (p: WorldPoint) => `${p.x} ${p.y} ${p.plane}`;
const message = (reason: unknown) => String(reason instanceof Error ? reason.message : reason);
const WORLD = { point: { x: 3000, y: 3300, plane: 0 }, zoom: 5 };
/** Listed in the side panel at most; the map shows them all. */
const LISTED = 300;

function CaseButton({ c, selected, onSelect }: { c: BenchmarkCase; selected: boolean; onSelect(): void }) {
  return <button type="button" aria-current={selected} onClick={onSelect}>
    <span className="wb-unit-title">{c.name}</span>
    <span className="wb-unit-meta">{c.description && c.description !== c.name ? `${c.description} · ` : ""}{c.profile} · {expectation(c)}</span>
  </button>;
}

function Verdict({ run }: { run: BenchmarkRun }) {
  const { passed, message: why } = run.check;
  const label = passed === true ? "Passes" : passed === false ? "Fails" : run.reached ? "Reached" : "Not reached";
  const tone = passed === false || (passed === null && !run.reached) ? "removed" : "added";
  return <span className="wb-verdict" style={{ background: TONES[tone] }} title={why || undefined}>{label}</span>;
}

function RunPanel({ c, run, error, onShow }: { c: BenchmarkCase; run?: BenchmarkRun; error?: string; onShow(point: WorldPoint): void }) {
  const tile = (p: WorldPoint) => <button type="button" className="wb-tile" title="Show on the map" onClick={() => onShow(p)}>{point(p)}</button>;
  const phases = run?.phasesMs ? Object.entries(run.phasesMs).filter(([, ms]) => ms >= 0.01) : [];
  return <section className="wb-detail" aria-label="Benchmark case">
    <h2>{run && <Verdict run={run} />}{c.name} <small>{c.suite}</small></h2>
    {c.description && c.description !== c.name && <p>{c.description}</p>}
    <dl className="wb-facts">
      <dt>Route</dt><dd className="wb-mono">{tile(worldPoint(c.start))} → {tile(worldPoint(c.target))}{!c.allowTransports && " · walking only"}</dd>
      <dt>Account</dt><dd>{c.profile}{c.tiers.length ? <span className="wb-note"> · tiers {c.tiers.join(", ")}</span> : null}</dd>
      <dt>Expected</dt><dd>{expectation(c)}</dd>
      {error ? <><dt>Run</dt><dd className="wb-warning" role="alert">{error}</dd></>
        : !run ? <><dt>Run</dt><dd role="status">Running…</dd></>
        : <>
          <dt>Result</dt><dd>{run.reached ? `reached, ${run.cost} ticks, ${run.pathLength} steps` : `not reached (${run.termination?.toLowerCase().replace(/_/g, " ")})`}
            {run.check.message && <span className="wb-note"> · {run.check.message}</span>}</dd>
          <dt>Time</dt><dd>{run.totalMs} ms on the service's {run.backend === "astar" ? "A*" : run.backend}
            {run.statesPopped != null && <span className="wb-note"> · {run.statesPopped.toLocaleString()} states popped</span>}
            {phases.length > 0 && <details className="wb-source"><summary>Phases</summary>
              <div className="wb-details">{phases.map(([name, ms]) => <span key={name}><b>{name}</b> {ms} ms</span>)}</div></details>}</dd>
          <dt>Transports</dt><dd>{run.transports.length ? <ol className="wb-steps">{run.transports.map(used =>
            <li key={used.step}><button type="button" className="wb-tile" title="Show on the map"
              onClick={() => { const [x, y, plane] = run.path[used.step]; onShow({ x, y, plane }); }}>{used.info || used.object || used.type}</button>
              <span className="wb-note"> {used.type.toLowerCase().replace(/_/g, " ")} · {used.duration} ticks</span></li>)}</ol> : "none"}</dd>
        </>}
    </dl>
  </section>;
}

export function BenchmarksPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<BenchmarkState>(() => readBenchmarkState(location.search));
  const [settings, setSettings] = useState<LayerSettings>(() => readLayerSettings(new URLSearchParams(location.search)));
  const update = (next: Partial<BenchmarkState>) => setState(current => ({ ...current, ...next }));
  // The URL follows the filters, the case and the layers, so a link opens the same view.
  useEffect(() => {
    const params = writeLayerSettings(new URLSearchParams(writeBenchmarkState(state)), settings);
    const search = params.toString().replace(/%2C/g, ",");
    if ((search && `?${search}`) !== location.search) navigate({ search: search && `?${search}` }, { replace: true });
  }, [state, settings]);
  useEffect(() => { document.title = "Benchmarks · Workbench"; }, []);

  const [index, setIndex] = useState<BenchmarkIndex>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    loadBenchmarks(abort.signal).then(setIndex, reason => { if (!abort.signal.aborted) setError(message(reason)); });
    return () => abort.abort();
  }, []);

  const all = index?.scenarios || [];
  const inSuite = useMemo(() => filterCases(all, { suite: state.suite }), [all, state.suite]);
  const shown = useMemo(() => filterCases(all, state), [all, state]);
  const selected = useMemo(() => state.selected && all.find(c => c.suite === state.selected!.suite && c.name === state.selected!.name),
    [all, state.selected]);

  // The selected case, run once by the service and drawn as a route.
  const [run, setRun] = useState<BenchmarkRun>();
  const [runError, setRunError] = useState<string>();
  useEffect(() => {
    setRun(undefined); setRunError(undefined);
    if (!selected) return;
    const abort = new AbortController();
    runBenchmark(selected.suite, selected.name, abort.signal).then(setRun, reason => { if (!abort.signal.aborted) setRunError(message(reason)); });
    return () => abort.abort();
  }, [selected]);

  // Cases under a coverage mark clicked on the map.
  const [atMark, setAtMark] = useState<{ key: string; cases: BenchmarkCase[] }>();
  const coverage = state.layers ?? DEFAULT_COVERAGE;
  const coverageKey = coverage.join(",");
  const marks = useMemo(() => coverageFeatures(shown, coverage), [shown, coverageKey]);
  const page = useMemo<FeatureOverlay>(() => {
    // A selected case is about its route, which lays out the map; otherwise the coverage marks are
    const anchors: MapFeature[] = selected ? [] : marks.filter(feature => feature.kind === "point");
    return { features: marks, anchors, selected: atMark?.key };
  }, [marks, selected, atMark?.key]);

  const [focusBox, setFocusBox] = useState<WorldBox>();
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  const [picked, setPicked] = useState<WorldPoint>();
  const layers = useWorkbenchLayers({ settings, update: setSettings, defaults: [], overlay: page, inspected: picked, focus: setFocusBox });

  // The coverage layers are the page's own, kept in the URL apart from the workbench's shared layers
  const toggleCoverage = (id: string, on: boolean) => {
    const next = COVERAGE_LAYERS.filter(layer => layer === id ? on : coverage.includes(layer));
    const same = next.length === DEFAULT_COVERAGE.length && next.every(layer => DEFAULT_COVERAGE.includes(layer));
    update({ layers: same ? undefined : next });
  };
  const coverageEntries: MapLayerEntry[] = [
    { id: "starts", label: "Case starts", swatch: TONES.start, on: coverage.includes("starts"),
      title: "Where the cases listed start, one mark a tile however many cases start there" },
    { id: "targets", label: "Case targets", swatch: TONES.target, on: coverage.includes("targets"),
      title: "Where the cases listed end, one mark a tile" },
    { id: "lines", label: "Start to target", swatch: TONES.coverage, on: coverage.includes("lines"),
      title: "A light line from each listed case's start to its target" },
  ];
  const toggle = (id: string, on: boolean) => (COVERAGE_LAYERS as readonly string[]).includes(id) ? toggleCoverage(id, on) : layers.toggle(id, on);

  const select = (c: BenchmarkCase) => { setAtMark(undefined); update({ selected: { suite: c.suite, name: c.name } }); };
  const onSelectFeatures = (keys: string[], tile: WorldPoint) => {
    const mark = keys.find(key => key.startsWith("coverage:"));
    if (mark) {
      const cases = casesAt(shown, mark);
      setAtMark({ key: mark, cases });
      if (cases.length === 1) select(cases[0]);
      return;
    }
    if (!layers.pick(keys)) setPicked(tile);
  };

  const categories = useMemo(() => counts(inSuite, c => [c.category]), [inSuite]);
  const tiers = useMemo(() => counts(inSuite, c => c.tiers), [inSuite]);
  const profiles = useMemo(() => counts(inSuite, c => [c.profile]), [inSuite]);
  const shownCategories = new Set(state.categories ?? categories.map(([name]) => name));
  const setCategories = (names: string[]) => update({ categories: names.length === categories.length ? undefined : names, selected: undefined });
  const listed = atMark?.cases ?? shown;
  const [style, setStyle] = useState(savedStyle);
  const styles = Object.entries(mapLayers) as [MapStyle, MapLayer][];

  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link>
      <span className="wb-tool">Benchmarks</span>
      {index && <span className="wb-summary">{all.length.toLocaleString()} cases in {index.suites.length} suites</span>}
    </header>
    {error && <p className="wb-warning" role="alert">{error}</p>}
    <div className="wb-body">
      <nav className="wb-units wb-explorer-side" aria-label="Benchmark cases">
        <div className="wb-bench-filters">
          <label>Suite <select aria-label="Suite" value={state.suite || ""} onChange={event => update({ suite: event.target.value || undefined, categories: undefined, tier: undefined, profile: undefined, selected: undefined })}>
            <option value="">All suites ({all.length})</option>
            {index?.suites.map(suite => <option key={suite.name} value={suite.name}>{suite.name} ({suite.scenarios})</option>)}
          </select></label>
          {tiers.length > 0 && <label>Tier <select aria-label="Tier" value={state.tier || ""} onChange={event => update({ tier: event.target.value || undefined })}>
            <option value="">Any</option>{tiers.map(([tier, n]) => <option key={tier} value={tier}>{tier} ({n})</option>)}
          </select></label>}
          {profiles.length > 1 && <label>Account <select aria-label="Account" value={state.profile || ""} onChange={event => update({ profile: event.target.value || undefined })}>
            <option value="">Any</option>{profiles.map(([profile, n]) => <option key={profile} value={profile}>{profile} ({n})</option>)}
          </select></label>}
          <details className="wb-filters">
            <summary>Categories {state.categories ? `(${state.categories.length} of ${categories.length})` : `(all ${categories.length})`}</summary>
            <div className="wb-filter-actions">
              <button type="button" onClick={() => setCategories(categories.map(([name]) => name))}>All</button>
              <button type="button" onClick={() => setCategories([])}>None</button>
            </div>
            {categories.map(([category, n]) => <label key={category}>
              <input type="checkbox" checked={shownCategories.has(category)} onChange={event => setCategories(event.target.checked
                ? [...shownCategories, category] : [...shownCategories].filter(name => name !== category))} />
              {category} <small>{n}</small>
            </label>)}
          </details>
          <input type="search" aria-label="Search cases" placeholder="Name, category or place" value={state.query || ""}
            onChange={event => update({ query: event.target.value || undefined })} />
        </div>
        {atMark ? <p className="wb-list-heading" role="status">{atMark.cases.length} {atMark.cases.length === 1 ? "case" : "cases"} at this mark{" "}
          <button type="button" className="wb-link" onClick={() => setAtMark(undefined)}>back to all listed</button></p>
          : <p className="wb-list-heading" role="status">{!index ? "Loading…" : `${shown.length.toLocaleString()} ${shown.length === 1 ? "case" : "cases"}`}</p>}
        <ol>{listed.slice(0, LISTED).map(c => <li key={caseKey(c)}>
          <CaseButton c={c} selected={c === selected} onSelect={() => select(c)} />
        </li>)}</ol>
        {listed.length > LISTED && <p className="wb-note">and {(listed.length - LISTED).toLocaleString()} more on the map</p>}
      </nav>
      <main className="wb-main">
        <section className="wb-map">
          {insetPin ? <Suspense fallback={<div className="route-map" role="status">Loading inset map…</div>}>
            <InsetMap inspectCoordinates overlay={layers.overlay} style={style} insets keepFocus
              route={run?.plan} start={run?.plan.start} destination={run?.plan.destination}
              onPick={tile => setPicked(tile)} onRoutingCrossing={layers.routing.selectCrossing} onFallback={() => {}}
              onSelectFeatures={onSelectFeatures} onView={layers.onView} fitSelection={false} fitAnchors={false}
              initialCentre={WORLD} focusBox={focusBox} focusTile={focusTile} />
          </Suspense> : <p className="wb-message">Insets are not available for these map tiles.</p>}
          {insetPin && styles.length > 1 && <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {styles.map(([id, { label }]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id); saveStyle(id); }}>{label}</button>)}
          </div>}
          {insetPin && <LayerControl layers={[...coverageEntries, ...layers.layers]} onToggle={toggle} />}
        </section>
        <div className="wb-below-map">
          {selected ? <RunPanel c={selected} run={run} error={runError} onShow={p => setFocusTile({ point: p })} />
            : <section className="wb-detail wb-hint-panel"><p className="wb-note">Pick a case to run it on the service's engine and see its route,
              or click a mark on the map for the cases starting or ending there. The filters choose the cases listed and marked.</p></section>}
          {layers.panel && <div className="wb-detail">{layers.panel}</div>}
          {layers.routing.panel && <div className="wb-detail">{layers.routing.panel}</div>}
        </div>
      </main>
    </div>
    <footer className="wb-footer wb-provenance">
      {index && <>
        <span className="wb-prov ok"><b>Cases</b> {index.tooling.repository}@{index.tooling.rev.slice(0, 8)}</span>
        <span className="wb-prov ok"><b>Engine</b> {index.plugin.repository}@{index.plugin.rev.slice(0, 8)}</span>
      </>}
      {layers.routing.provenance && <span className="wb-prov ok" title="Verified against these tiles"><b>Routing</b> {layers.routing.provenance}</span>}
    </footer>
  </div>;
}

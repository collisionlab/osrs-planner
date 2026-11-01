import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapStyle } from "../../map/layers";
import { featurePoints } from "../../map/insets/features";
import { LayerControl } from "../../map/insets/LayerControl";
import type { WorldBox } from "../../map/insets/projection";
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { fileName, filterFindings, findingLabel, findingOverlay, invariantNames, invariants, loadInvariants, pointText, reviewNote,
  sourceUrl, type Finding, type InvariantReport } from "./invariants";
import { useUrlLayerSettings, useWorkbenchLayers } from "./WorkbenchLayers";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));
/** The layers findings open with: their rows over the release's collision. */
const FINDING_LAYERS = ["collision"];
const PAGE = 80;

/**
 * The plugin data's invariants, checked live by the service against the plugin it bundles. Each
 * finding is a row to fix in the data; fixing it removes it from the next release's list.
 */
export function InvariantsPage() {
  const location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const invariant = params.get("invariant") ?? "", query = params.get("q") ?? "";
  const wanted = new URLSearchParams(location.hash.slice(1)).get("finding");
  const [report, setReport] = useState<InvariantReport>();
  const [error, setError] = useState("");
  const [manifest, setManifest] = useState<CollisionManifest>();
  const [style, setStyle] = useState(savedStyle);
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    document.title = "Transport invariants · Workbench";
    const abort = new AbortController();
    loadInvariants(abort.signal).then(setReport, reason => { if (!abort.signal.aborted) setError(String(reason)); });
    loadCollisionManifest(abort.signal).then(setManifest, () => {});
    return () => abort.abort();
  }, []);
  const findings = useMemo(() => filterFindings(report?.findings ?? [], invariant, query), [report, invariant, query]);
  const index = Math.max(0, findings.findIndex(f => f.id === wanted));
  const finding = findings[index];
  const pageStart = Math.floor(index / PAGE) * PAGE;
  const select = (next: number) => {
    const f = findings[Math.max(0, Math.min(findings.length - 1, next))];
    if (f) navigate({ search: location.search, hash: "finding=" + f.id });
  };
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value); else next.delete(key);
    navigate({ search: next.toString(), hash: location.hash }, { replace: true });
  };
  // Even the first selection is shareable.
  useEffect(() => {
    if (finding && finding.id !== wanted) navigate({ search: location.search, hash: "finding=" + finding.id }, { replace: true });
  }, [finding, wanted, location.search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)
        || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") { event.preventDefault(); select(index + 1); }
      if (event.key === "k") { event.preventDefault(); select(index - 1); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [index, findings, location.search]);
  useEffect(() => setCopyStatus(""), [finding]);
  const geometry = useMemo(() => finding && findingOverlay(finding), [finding]);
  const [settings, updateSettings] = useUrlLayerSettings();
  const [inspected, setInspected] = useState<WorldPoint>();
  const [focusBox, setFocusBox] = useState<WorldBox>();
  const layers = useWorkbenchLayers({ settings, update: updateSettings, defaults: FINDING_LAYERS, overlay: geometry, inspected, focus: setFocusBox });
  const collision = layers.collision;
  useEffect(() => {
    if (!geometry) return;
    const abort = new AbortController();
    void collision.load(geometry.anchors.flatMap(featurePoints), 1, abort.signal);
    return () => abort.abort();
  }, [geometry, collision]);
  const count = (name: string) => report?.findings.filter(f => f.invariant === name).length ?? 0;
  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link><span className="wb-tool">Transport invariants</span>
      {report && <span className="wb-summary">{invariants.map(name => `${count(name)} ${invariantNames[name].toLowerCase()}`).join(" · ")}</span>}
      <span className="wb-keys"><kbd>j</kbd>/<kbd>k</kbd> next/previous</span>
    </header>
    {error ? <p className="wb-message" role="alert">{error}</p> : !report ? <p className="wb-message" role="status">Checking the plugin data…</p>
      : <div className="wb-body wb-invariants-body">
        <nav className="wb-units" aria-label="Findings">
          <div className="wb-pad wb-form">
            <label>Invariant<select aria-label="Invariant" value={invariant} onChange={e => filter("invariant", e.target.value)}>
              <option value="">All invariants</option>{invariants.map(name => <option key={name} value={name}>{invariantNames[name]} ({count(name)})</option>)}
            </select></label>
            {invariant ? <p className="wb-note">{report.rules[invariant as keyof typeof report.rules]}</p>
              : <details><summary>What do the invariants say?</summary>
                {invariants.map(name => <p className="wb-note" key={name}><strong>{invariantNames[name]}:</strong> {report.rules[name]}</p>)}
              </details>}
            <label>Search findings<input value={query} placeholder="File, action, tile or name" onChange={e => filter("q", e.target.value)} /></label>
            <p className="wb-note" role="status">{findings.length} findings shown</p>
            <div className="wb-inline">
              <button type="button" disabled={!finding || index === 0} onClick={() => select(index - 1)}>Previous</button>
              <button type="button" disabled={!finding || index === findings.length - 1} onClick={() => select(index + 1)}>Next</button>
            </div>
          </div>
          {findings.length > PAGE && <div className="wb-pad wb-inline">
            <span>Findings {pageStart + 1}–{Math.min(pageStart + PAGE, findings.length)} of {findings.length}</span>
            <button type="button" disabled={pageStart === 0} onClick={() => select(pageStart - PAGE)}>Previous page</button>
            <button type="button" disabled={pageStart + PAGE >= findings.length} onClick={() => select(pageStart + PAGE)}>Next page</button>
          </div>}
          <ol>{findings.slice(pageStart, pageStart + PAGE).map((f, i) => <li key={f.id}><button type="button" aria-current={index === pageStart + i} onClick={() => select(pageStart + i)}>
            <span className="wb-unit-title">{findingLabel(f)}</span>
            <span className="wb-unit-meta">{invariantNames[f.invariant]} · {fileName(f)}:{f.line}</span>
            {f.review.status !== "unreviewed" && <span className="wb-unit-meta">{f.review.status.replaceAll("_", " ")}</span>}
          </button></li>)}</ol>
        </nav>
        <section className="wb-map wb-insets-map" aria-label="Finding map">
          {geometry && insetPin ? <Suspense fallback={<p className="wb-message">Loading inset map…</p>}>
            <InsetMap inspectCoordinates overlay={layers.overlay} focusTile={focusTile} focusBox={focusBox} style={style} insets
              onPick={point => { layers.clearPick(); setInspected(point); }} onFallback={() => {}}
              onView={layers.onView} onMoveHub={layers.moveHub} onRoutingCrossing={layers.routing.selectCrossing}
              onSelectFeatures={(keys, point) => { if (!layers.pick(keys)) setInspected(point); }} />
          </Suspense> : <p className="wb-message">{finding ? "Insets are unavailable for these tiles." : "No findings match these filters."}</p>}
          <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {Object.entries(mapLayers).map(([id, layer]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id as MapStyle); saveStyle(id as MapStyle); }}>{layer.label}</button>)}
          </div>
          <div className="wb-finding-legend" aria-label="Geometry legend">
            <span>□ Origin · ■ Destination</span>
            <span className="suspect">Highlighted: the tile that breaks the rule</span>
          </div>
          {insetPin && geometry && <LayerControl layers={layers.layers} onToggle={layers.toggle} />}
        </section>
        <section className="wb-side-panel" aria-label="Finding details">
          <div className="wb-panel-body">
            {layers.panel}
            {layers.routing.panel && <div className="wb-detail">{layers.routing.panel}</div>}
            {finding && <FindingDetail finding={finding} report={report} show={point => setFocusTile({ point })}
              copy={async () => {
                try { await navigator.clipboard.writeText(reviewNote(finding, report.plugin)); setCopyStatus("Review note copied"); }
                catch { setCopyStatus("Could not access clipboard"); }
              }} />}
            {copyStatus && <p role="status">{copyStatus}</p>}
            <p className="wb-note">Checked against the service's bundled plugin collision and data. Displayed map collision:
              tiles {tiles.version}, cache {manifest?.cacheId ?? "unknown"}; its revision may differ.</p>
          </div>
        </section>
      </div>}
    <footer className="wb-footer">
      {provenance(report, manifest).map(line => <span key={line.subject} className={`wb-prov ${line.status}`}><b>{line.subject}</b> {line.text}</span>)}
    </footer>
  </div>;
}

function FindingDetail({ finding: f, report, show, copy }: { finding: Finding; report: InvariantReport; show(p: WorldPoint): void; copy(): void }) {
  const ends = f.invariant === "location" ? [["location", f.focus] as const]
    : [["origin", f.row.origin] as const, ["destination", f.row.destination] as const];
  return <article className="wb-section wb-finding-detail" data-finding-id={f.id}>
    <h2>{findingLabel(f)}</h2>
    <p><strong>{invariantNames[f.invariant]}</strong> · <a href={sourceUrl(f, report.plugin)}>{fileName(f)}:{f.line}</a>{f.row.section && <> · {f.row.section}</>}</p>
    <p className="wb-warning">{f.failure}</p>
    <p className="wb-note">{report.rules[f.invariant]}</p>
    <table className="wb-rows"><tbody>{ends.map(([end, point]) => <tr key={end}><th>{end}</th><td>
      <button type="button" className={`wb-tile ${point && pointText(point) === pointText(f.focus) ? "suspect" : ""}`} disabled={!point}
        onClick={() => point && show(point)}>{pointText(point)}</button></td></tr>)}</tbody></table>
    {f.invariant !== "location" && <details><summary>Transport fields</summary><table className="wb-rows"><tbody>
      {Object.entries(f.row.fields).map(([name, value]) => <tr key={name}><th>{name}</th><td>{value || "—"}</td></tr>)}
    </tbody></table></details>}
    <details><summary>Exact row</summary><pre className="wb-draft-text">{f.raw}</pre></details>
    <p className="wb-mono">{f.id}</p>
    <p><b>Review ledger:</b> {f.review.status}{f.review.explanation ? " — " + f.review.explanation : ""}</p>
    {f.review.reference && <p>Decision reference: {f.review.reference}</p>}
    <button type="button" onClick={copy}>Copy review note</button>
  </article>;
}

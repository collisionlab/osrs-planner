import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapStyle } from "../../map/layers";
import { CollisionMap, releaseTiles } from "../../map/insets/collision";
import { COLLISION_RADIUS } from "../../map/insets/composition";
import { featurePoints } from "../../map/insets/features";
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { baselineUrl, candidateKind, candidateLabel, candidateOverlay, categories, categoryDescriptions, contributorUrl, displacement, fieldComparison, filterUnits,
  groupCandidates, loadCandidates, pointText, reconciliationStatuses, referencedGroups, reviewNote, type Candidate, type Catalogue, type ItemGroup } from "./candidates";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));
const label = (value: string) => value.replaceAll("_", " ");

export function CandidatesPage() {
  const location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const category = params.get("category") ?? "", status = params.get("status") ?? "", query = params.get("q") ?? "";
  const wanted = new URLSearchParams(location.hash.slice(1)).get("candidate");
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [error, setError] = useState("");
  const [manifest, setManifest] = useState<CollisionManifest>();
  const [style, setStyle] = useState(savedStyle);
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    document.title = "Transport candidates · Workbench";
    const abort = new AbortController();
    loadCandidates(abort.signal).then(setCatalogue, reason => { if (!abort.signal.aborted) setError(String(reason)); });
    loadCollisionManifest(abort.signal).then(setManifest, () => {});
    return () => abort.abort();
  }, []);
  const allUnits = useMemo(() => groupCandidates(catalogue?.candidates ?? []), [catalogue]);
  const units = useMemo(() => filterUnits(allUnits, category, status, query), [allUnits, category, status, query]);
  const index = Math.max(0, units.findIndex(unit => unit.candidates.some(c => c.id === wanted)));
  const unit = units[index];
  const pageStart = Math.floor(index / 80) * 80;
  const listed = units.slice(pageStart, pageStart + 80);
  const selected = unit?.candidates.find(c => c.id === wanted);
  const select = (next: number) => {
    const candidate = units[Math.max(0, Math.min(units.length - 1, next))]?.candidates[0];
    if (candidate) navigate({ search: location.search, hash: "candidate=" + candidate.id });
  };
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value); else next.delete(key);
    navigate({ search: next.toString(), hash: location.hash }, { replace: true });
  };
  // Even the first selection is shareable. Filters keep a selected reverse direction when visible.
  useEffect(() => {
    if (unit && !selected) navigate({ search: location.search, hash: "candidate=" + unit.candidates[0].id }, { replace: true });
  }, [unit, selected, location.search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)
        || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") { event.preventDefault(); select(index + 1); }
      if (event.key === "k") { event.preventDefault(); select(index - 1); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [index, units, location.search]);
  const collision = useMemo(() => new CollisionMap(releaseTiles(tiles.base, tiles.version)), []);
  const [ready, setReady] = useState<string>();
  useEffect(() => {
    setCopyStatus("");
    if (!unit) return;
    const abort = new AbortController();
    const points = candidateOverlay(unit).anchors.flatMap(featurePoints);
    void collision.load(points, COLLISION_RADIUS + 1, abort.signal).then(() => {
      if (!abort.signal.aborted) setReady(unit.id);
    });
    return () => abort.abort();
  }, [unit, collision]);
  const overlay = useMemo(() => unit && candidateOverlay(unit, ready === unit.id ? collision : undefined, selected?.id),
    [unit, ready, collision, selected]);
  const show = (p: WorldPoint) => setFocusTile({ point: p });
  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link><span className="wb-tool">Transport candidates</span>
      {catalogue && <span className="wb-summary">{catalogue.candidates.filter(c => candidateKind(c) !== "destination_violation").length} suggestion rows · {catalogue.candidates.filter(c => candidateKind(c) === "destination_violation").length} destination violations · {allUnits.length} review units</span>}
      <span className="wb-keys"><kbd>j</kbd>/<kbd>k</kbd> next/previous</span>
    </header>
    {error ? <p className="wb-message" role="alert">{error}</p> : !catalogue ? <p className="wb-message" role="status">Loading candidates…</p>
      : <div className="wb-body wb-candidates-body">
        <nav className="wb-units" aria-label="Candidates">
          <div className="wb-pad wb-form">
            <label>Category<select aria-label="Category" value={category} onChange={e => filter("category", e.target.value)}>
              <option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{label(c)} ({catalogue.candidates.filter(row => row.category === c).length})</option>)}
            </select></label>
            {category && <p className="wb-note">{categoryDescriptions[category as keyof typeof categoryDescriptions]}</p>}
            <details><summary>What do the categories mean?</summary>
              {categories.map(c => <p className="wb-note" key={c}><strong>{label(c)}:</strong> {categoryDescriptions[c]}</p>)}
            </details>
            <label>Reconciliation status<select aria-label="Reconciliation status" value={status} onChange={e => filter("status", e.target.value)}>
              <option value="">All statuses</option>{reconciliationStatuses.map(s => <option key={s} value={s}>{label(s)} ({catalogue.candidates.filter(row => row.reconciliation.status === s).length})</option>)}
            </select></label>
            <label>Search candidates<input value={query} placeholder="File, action, tile or source" onChange={e => filter("q", e.target.value)} /></label>
            <p className="wb-note" role="status">{units.reduce((n, u) => n + u.candidates.length, 0)} rows · {units.length} review units shown</p>
            <div className="wb-inline">
              <button type="button" disabled={!unit || index === 0} onClick={() => select(index - 1)}>Previous</button>
              <button type="button" disabled={!unit || index === units.length - 1} onClick={() => select(index + 1)}>Next</button>
            </div>
          </div>
          {units.length > 80 && <div className="wb-pad wb-inline">
            <span>Units {pageStart + 1}–{Math.min(pageStart + 80, units.length)} of {units.length}</span>
            <button type="button" disabled={pageStart === 0} onClick={() => select(pageStart - 80)}>Previous page</button>
            <button type="button" disabled={pageStart + 80 >= units.length} onClick={() => select(pageStart + 80)}>Next page</button>
          </div>}
          <ol>{listed.map((u, i) => <li key={u.id}><button type="button" aria-current={index === pageStart + i} onClick={() => select(pageStart + i)}>
            <span className="wb-unit-title">{candidateLabel(u.candidates[0])}</span>
            <span className="wb-unit-meta">{label(u.candidates[0].category)} · {u.candidates.length === 2 ? "reverse pair" : "1 row"}</span>
            <span className="wb-unit-meta">{u.candidates.map(c => label(c.reconciliation.status)).join(" / ")}</span>
          </button></li>)}</ol>
        </nav>
        <section className="wb-map wb-insets-map" aria-label="Candidate map">
          {overlay && insetPin ? <Suspense fallback={<p className="wb-message">Loading inset map…</p>}>
            <InsetMap inspectCoordinates overlay={overlay} focusTile={focusTile} style={style} insets onPick={() => {}} onFallback={() => {}}
              onSelectFeatures={keys => {
                const c = unit?.candidates.find(row => row.id === keys[0]);
                if (c) navigate({ search: location.search, hash: "candidate=" + c.id });
              }} />
          </Suspense> : <p className="wb-message">{unit ? "Insets are unavailable for these tiles." : "No candidates match these filters."}</p>}
          <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {Object.entries(mapLayers).map(([id, layer]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id as MapStyle); saveStyle(id as MapStyle); }}>{layer.label}</button>)}
          </div>
          <div className="wb-candidate-legend" aria-label="Geometry legend">
            {unit?.candidates[0].kind === "destination_violation" ? <span>Current transport · highlighted destination violates the rule</span> : <><span className="removed">┄ Original: dashed edge, dashed tiles</span>
            <span className="added">━ Suggested: solid edge, solid tiles</span>
            <span className="changed">━ Shared geometry / original-only note</span></>}
            <span>□ Origin · ■ Destination · shared tiles drawn once</span>
            {unit?.candidates[0].kind === "network_stop" && <span>Stop tiles only; no network routes implied</span>}
          </div>
        </section>
        <section className="wb-side-panel" aria-label="Candidate details">
          <div className="wb-panel-body">
            {unit?.candidates[0].kind === "destination_violation" ? <>
              <p className="wb-callout">Current destination violations. Each landing tile is blocked and is not the exact origin of a transport. Seasonal transports are excluded. No correction has been proposed.</p>
              <p className="wb-note">Checks use the service's bundled plugin collision and transport data. Displayed map collision: tiles {tiles.version}, cache {manifest?.cacheId ?? "unknown"}; its revision may differ.</p>
            </> : <><p className="wb-callout">Unverified suggestions. Reconciliation checks the starting row; map inspection helps assess plausibility.
              Neither proves a correction was verified in-game. An accepted ledger decision does not change transport data.</p>
            <p className="wb-note">Contributor tile evidence: cache 2735 and their comparison with upstream collision at 0fb23cda.
              Displayed collision: tiles {tiles.version}, cache {manifest?.cacheId ?? "unknown"}. Blocked flags do not establish whether a special transition tile is legitimate.</p></>}
            {unit?.candidates.map(c => <CandidateDetail key={c.id} candidate={c} selected={selected?.id === c.id}
              itemGroups={catalogue.itemGroups ?? []}
              collision={ready === unit.id ? collision : undefined} show={show}
              select={() => navigate({ search: location.search, hash: "candidate=" + c.id })}
              copy={async () => {
                try { await navigator.clipboard.writeText(reviewNote(c)); setCopyStatus("Review note copied"); }
                catch { setCopyStatus("Could not access clipboard"); }
              }} />)}
            {copyStatus && <p role="status">{copyStatus}</p>}
          </div>
        </section>
      </div>}
    <footer className="wb-footer">
      <span>Suggestions: rel-osrs/shortest-path@ca9ed248 · baseline 0fb23cda</span>
      {provenance(catalogue, manifest).map(line => <span key={line.subject} className={`wb-prov ${line.status}`}><b>{line.subject}</b> {line.text}</span>)}
    </footer>
  </div>;
}

function CandidateDetail({ candidate: c, selected, collision, show, select, copy, itemGroups }: {
  candidate: Candidate; selected: boolean; collision?: CollisionMap; show(p: WorldPoint): void; select(): void; copy(): void; itemGroups: ItemGroup[];
}) {
  if (candidateKind(c) === "destination_violation") return <DestinationViolationDetail candidate={c} selected={selected} show={show} select={select} copy={copy} />;
  const kind = candidateKind(c), groups = referencedGroups(c, itemGroups), fields = fieldComparison(c);
  const collisionText = (p: WorldPoint | null) => {
    const tile = p && collision?.tile(p);
    return !tile ? "unavailable" : tile.blocked ? "all edges closed" : "one or more open edges";
  };
  return <article className={`wb-section wb-candidate-detail ${selected ? "selected" : ""}`} data-candidate-id={c.id}>
    <h2><button type="button" className="wb-link" onClick={select}>{candidateLabel(c)}</button></h2>
    <p>{label(c.category)} · {c.file ? <><a href={baselineUrl(c)}>{c.file}:{c.originalLine}</a> (original line only)</>
      : <>new proposal · {c.sourceFile}:{c.sourceLine}</>}</p>
    <p className="wb-mono">{c.id}</p>
    <p><b>Current data:</b> <span className={c.reconciliation.status === "matches_current" ? "" : "changed"}>{c.reconciliation.status}</span></p>
    {c.original && c.reconciliation.status !== "matches_current" && <p className="wb-warning">The starting row is unresolved or has changed. The original geometry below is from the contributor baseline.</p>}
    {!c.original && <p className="wb-warning">No original upstream row was supplied. Reconciliation finds exact endpoint correspondences only;
      it does not establish equivalent requirements or prove that a proposal is absent from current data.</p>}
    {kind === "requirement_note" && <p className="wb-warning">The contributor supplied no representable replacement row. Original geometry is shown for investigation; the requirement model is unchanged.</p>}
    {c.category.startsWith("copied_area") && <p className="wb-warning">Copy of another area: this may be a quest or cutscene instance and may not belong in ordinary routing.</p>}
    {c.category === "unsourced_transport" && <p className="wb-warning">Tile evidence is not recorded. A source citation may describe requirements without supporting these coordinates.</p>}
    {c.network && <p><b>Network:</b> {c.network}. Boarding and landing tiles describe one stop; no connections to other stops are inferred.</p>}
    <table className="wb-rows"><thead><tr><th>Endpoint</th><th>Original (0fb23cda)</th><th>Suggested</th></tr></thead>
      <tbody>{(["origin", "destination"] as const).map(end => <tr key={end}>
        <td>{kind === "network_stop" ? end === "origin" ? "Board at" : "Land at" : end}</td>{(["original", "suggested"] as const).map(version => {
          const p = c[version]?.[end], old = c.original?.[end];
          return <td key={version}><button type="button" className="wb-tile" disabled={!p} onClick={() => { select(); if (p) show(p); }}>
            {version === "suggested" && p && old ? <>{(["x", "y", "plane"] as const).map((axis, i) => <span key={axis}>{i ? " " : ""}{p[axis] !== old[axis] ? <mark>{p[axis]}</mark> : p[axis]}</span>)}</> : pointText(p)}
          </button></td>;
        })}
      </tr>)}</tbody>
    </table>
    {c.original && c.suggested && <p>Origin: {displacement(c.original.origin, c.suggested.origin)}<br />Destination: {displacement(c.original.destination, c.suggested.destination)}</p>}
    <p className="wb-note">Displayed collision flags (original → suggested):<br />
      Origin: {collisionText(c.original?.origin ?? null)} → {collisionText(c.suggested?.origin ?? null)}<br />
      Destination: {collisionText(c.original?.destination ?? null)} → {collisionText(c.suggested?.destination ?? null)}</p>
    {fields.length > 0 && <details open={c.category === "missing_requirements" || kind === "requirement_note"}>
      <summary>Transport fields and requirement text</summary>
      <p className="wb-note">Contributor values are shown verbatim. Item groups, quest names, and conditions are evidence to review, not evaluated capabilities.</p>
      <table className="wb-rows wb-candidate-fields"><thead><tr><th>Field</th><th>Original</th><th>Suggested</th></tr></thead>
        <tbody>{fields.map(f => <tr key={f.name}><td>{f.name}</td>
          <td>{f.before !== f.after ? <del>{f.before || "—"}</del> : f.before || "—"}</td>
          <td>{!c.suggested ? "No replacement supplied" : f.before !== f.after ? <ins>{f.after || "—"}</ins> : f.after || "—"}</td>
        </tr>)}</tbody></table>
    </details>}
    <p><b>Contributor explanation:</b> {c.whatChanges}</p>
    <p><b>Source citation:</b> {c.source === "none recorded" ? <strong className="changed">Missing evidence — none recorded</strong> : c.source}</p>
    <p><b>Other reported differences:</b> {c.alsoDiffers || "None reported"}</p>
    {c.needs !== undefined && <p><b>Needs outside the format:</b> {c.needs || "None recorded"}</p>}
    {c.uncheckedTicks !== undefined && <p><b>Contributor ticks (unchecked):</b> {c.uncheckedTicks || "None recorded"}. These are not verified timings.</p>}
    {groups.length > 0 && <details><summary>Contributor item groups ({groups.length})</summary>
      {groups.map(g => <div key={g.name}><h3>[{g.name}]</h3><p>{g.itemNames}</p><p className="wb-candidate-fields">Item IDs: {g.itemIds}</p>
        <a href={`https://github.com/${g.sourceRepository}/blob/${g.sourceCommit}/bestpath-candidates/item-groups.tsv#L${g.sourceLine}`}>Pinned group definition</a>
      </div>)}
    </details>}
    <p><a href={contributorUrl(c)}>Pinned contributor record</a>{c.file && <> · <a href={baselineUrl(c)}>Upstream baseline row</a></>}</p>
    <details><summary>Exact TSV rows and bundled correspondences</summary>
      <p>Original</p><pre className="wb-draft-text">{c.originalRaw ?? "No upstream row supplied"}</pre>
      <p>Suggested</p>{c.proposalHeader && <pre className="wb-draft-text">{c.proposalHeader}</pre>}
      <pre className="wb-draft-text">{c.suggestedRaw || "No representable replacement supplied"}</pre>
      {c.sourceRaw && <><p>Complete contributor record (including evidence)</p><pre className="wb-draft-text">{c.sourceHeader + "\n" + c.sourceRaw}</pre></>}
      <p>Current bundled rows: {c.reconciliation.rows.length} {["diverged", "ambiguous", "possible_existing"].includes(c.reconciliation.status) ? "possible correspondences, not confirmed identities" : ""}</p>
      {c.reconciliation.rows.map((value, index) => <div key={index}><p>{value.row.file}:{value.row.line} · {pointText(value.row.origin)} → {pointText(value.row.destination)}</p><pre className="wb-draft-text">{value.raw}</pre></div>)}
    </details>
    <p><b>Review ledger:</b> {c.review.status}{c.review.explanation ? " — " + c.review.explanation : ""}</p>
    {c.review.reference && <p>Decision reference: {c.review.reference}</p>}
    <button type="button" onClick={copy}>Copy review note</button>
  </article>;
}


function DestinationViolationDetail({ candidate: c, selected, show, select, copy }: {
  candidate: Candidate; selected: boolean; show(p: WorldPoint): void; select(): void; copy(): void;
}) {
  return <article className={`wb-section wb-candidate-detail ${selected ? "selected" : ""}`} data-candidate-id={c.id}>
    <h2><button type="button" className="wb-link" onClick={select}>{candidateLabel(c)}</button></h2>
    <p><strong>Destination violation</strong> · <a href={baselineUrl(c)}>{c.file}:{c.originalLine}</a></p>
    <p className="wb-mono">{c.id}</p>
    <p className="wb-warning">{c.whatChanges}</p>
    <p>No proposed correction yet. Investigate the current row and landing tile before suggesting a change.</p>
    <table className="wb-rows"><thead><tr><th>Endpoint</th><th>Current world coordinates</th></tr></thead>
      <tbody>{(["origin", "destination"] as const).map(end => {
        const point = c.original?.[end];
        return <tr key={end}><td>{end}</td><td><button type="button" className="wb-tile" disabled={!point}
          onClick={() => { select(); if (point) show(point); }}>{pointText(point)}</button></td></tr>;
      })}</tbody>
    </table>
    <p><b>Checked data:</b> {c.sourceRepository}@{c.sourceCommit}. {c.source}</p>
    <details><summary>Current transport fields</summary><table className="wb-rows"><tbody>
      {Object.entries(c.original?.fields ?? {}).map(([name, value]) => <tr key={name}><th>{name}</th><td>{value || "—"}</td></tr>)}
    </tbody></table></details>
    <details><summary>Exact current TSV row</summary><pre className="wb-draft-text">{c.originalRaw}</pre></details>
    <p><b>Review ledger:</b> {c.review.status}{c.review.explanation ? " — " + c.review.explanation : ""}</p>
    {c.review.reference && <p>Decision reference: {c.review.reference}</p>}
    <button type="button" onClick={copy}>Copy review note</button>
  </article>;
}

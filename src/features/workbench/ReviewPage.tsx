import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import tiles from "../../../tiles.json";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapLayer, type MapStyle } from "../../map/layers";
import { CollisionMap, releaseTiles } from "../../map/insets/collision";
import { COLLISION_RADIUS } from "../../map/insets/composition";
import { diffLineUrl, githubUrl, loadHeads, loadReview, parseSource, row, sourceLabel, sourcePath,
  type Review, type ReviewUnit, type RowChange } from "./api";
import type { WorldPoint } from "../../domain/contracts";
import { OpenPullPicker } from "./OpenPulls";
import { loadCollisionManifest, type CollisionManifest } from "./provenance";
import { changeOfKey, unitOverlay, unitPoints } from "./review";
import "./workbench.css";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));

const point = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "—";
const short = (sha: string) => sha.slice(0, 7);
/** Fields shown for every row; the rest only when they change. */
const DETAIL = ["Skills", "Items", "Quests", "Varbits", "VarPlayers", "Duration", "Display info"];

/** The selected unit, kept in the URL's hash (`#unit=transports-5872`) so a link can point at one. */
function useHashUnit(units: ReviewUnit[]) {
  const read = () => new URLSearchParams(window.location.hash.slice(1)).get("unit");
  const [wanted, setWanted] = useState(read);
  useEffect(() => {
    const onHash = () => setWanted(read());
    addEventListener("hashchange", onHash); return () => removeEventListener("hashchange", onHash);
  }, []);
  const index = Math.max(0, units.findIndex(unit => unit.id === wanted));
  const select = (next: number) => {
    const unit = units[Math.min(Math.max(next, 0), units.length - 1)];
    if (!unit) return;
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#unit=${unit.id}`);
    setWanted(unit.id);
  };
  return { index, select };
}

function ChangeBadge({ kind }: { kind: RowChange["kind"] }) {
  return <span className={`wb-badge ${kind}`}>{kind === "added" ? "+" : kind === "removed" ? "−" : "~"}</span>;
}

function UnitCounts({ unit }: { unit: ReviewUnit }) {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const change of unit.changes) counts[change.kind]++;
  return <span className="wb-counts">
    {counts.added > 0 && <span className="added">+{counts.added}</span>}
    {counts.removed > 0 && <span className="removed">−{counts.removed}</span>}
    {counts.changed > 0 && <span className="changed">~{counts.changed}</span>}
  </span>;
}

function RowTable({ review, unit, selected, onSelect, onShow }: { review: Review; unit: ReviewUnit; selected?: RowChange;
  onSelect(change: RowChange): void; onShow(point: WorldPoint): void }) {
  const [links, setLinks] = useState<Map<RowChange, string>>(new Map());
  useEffect(() => {
    let live = true;
    void Promise.all(unit.changes.map(async change => [change, await diffLineUrl(review, unit.file,
      row(change).line, change.head ? "R" : "L")] as const)).then(entries => { if (live) setLinks(new Map(entries)); });
    return () => { live = false; };
  }, [review, unit]);
  return <table className="wb-rows">
    <thead><tr><th /><th>Line</th><th>Origin</th><th>Destination</th><th>Object / info</th><th>Details</th></tr></thead>
    <tbody>{unit.changes.map(change => {
      const shown = row(change);
      const changed = new Map(change.fields.map(field => [field.name, field]));
      const cell = (name: string, value?: string) => {
        const field = changed.get(name);
        return field ? <><del>{field.before || "∅"}</del> → <ins>{field.after || "∅"}</ins></> : value;
      };
      const details = DETAIL.filter(name => shown.fields[name] || changed.has(name));
      return <tr key={`${shown.line}-${change.kind}`} className={change === selected ? "selected" : undefined} onClick={() => onSelect(change)}>
        <td><ChangeBadge kind={change.kind} /></td>
        <td><a href={links.get(change)} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{change.head ? "" : "was "}{shown.line}</a></td>
        {(["origin", "destination"] as const).map(end => <td key={end} className="wb-mono">
          {shown[end] ? <button type="button" className="wb-tile" title="Show on the map"
            onClick={event => { event.stopPropagation(); onSelect(change); onShow(shown[end]!); }}>{cell(end === "origin" ? "Origin" : "Destination", point(shown[end]))}</button> : "—"}
        </td>)}
        <td>{cell("menuOption menuTarget objectID", shown.fields["menuOption menuTarget objectID"] ?? shown.fields.Info)}</td>
        <td className="wb-details">{details.map(name => <span key={name}><b>{name}</b> {cell(name, shown.fields[name])}</span>)}</td>
      </tr>;
    })}</tbody>
  </table>;
}

/** The collision layer of the pinned tiles version, drawn around each unit. */
const releaseCollision = () => new CollisionMap(releaseTiles(tiles.base, tiles.version));

export function ReviewPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const kind = location.pathname.includes("/compare/") ? "compare" : "pull";
  const source = useMemo(() => parseSource(params.owner, params.repo, kind, kind === "pull" ? params.number : params["*"], params.range),
    [params.owner, params.repo, params.number, params["*"], params.range, kind]);
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!source) { setError("Not a GitHub pull request or compare URL."); return; }
    const abort = new AbortController();
    setReview(undefined); setError("");
    loadReview(source, abort.signal).then(loaded => {
      // A pull request as it is now: name the push in the URL, so the link shows these rows for good.
      if (source.kind === "pull" && !source.range) {
        navigate(sourcePath({ ...source, range: { base: loaded.base, head: loaded.head } }) + location.hash, { replace: true });
      }
      setReview(loaded);
    }, reason => { if (!abort.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => abort.abort();
  }, [source]);
  // A link names one push; say so when the pull request has moved on.
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    setNewer(false);
    if (source?.kind !== "pull" || !source.range) return;
    const abort = new AbortController();
    loadHeads(source, abort.signal).then(heads => setNewer(heads.head !== source.range!.head), () => {});
    return () => abort.abort();
  }, [source]);
  const units = review?.units ?? [];
  const { index, select } = useHashUnit(units);
  const unit = units[index];
  const [selectedChange, setSelectedChange] = useState<RowChange>();
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  useEffect(() => setSelectedChange(undefined), [unit]);
  // The map is drawn without collision until the unit's squares arrive.
  const collision = useMemo(releaseCollision, []);
  const [collisionReady, setCollisionReady] = useState<ReviewUnit>();
  useEffect(() => {
    if (!unit) return;
    const abort = new AbortController();
    void collision.load(unitPoints(unit), COLLISION_RADIUS + 1, abort.signal).then(() => { if (!abort.signal.aborted) setCollisionReady(unit); });
    return () => abort.abort();
  }, [unit, collision]);
  const overlay = useMemo(() => unit && unitOverlay(unit, collisionReady === unit ? collision : undefined, selectedChange),
    [unit, collisionReady, collision, selectedChange]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return;
      if (event.key === "j") select(index + 1);
      else if (event.key === "k") select(index - 1);
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [index, units]);
  useEffect(() => { document.title = source ? `Review ${sourceLabel(source)} · Workbench` : "Workbench"; }, [source]);
  const [style, setStyle] = useState(savedStyle);
  const [collisionManifest, setCollisionManifest] = useState<CollisionManifest>();
  useEffect(() => { const abort = new AbortController(); loadCollisionManifest(abort.signal).then(setCollisionManifest, () => {}); return () => abort.abort(); }, []);
  const styles = Object.entries(mapLayers) as [MapStyle, MapLayer][];
  const counts = review?.counts;
  return <div className="wb-page">
    <header className="wb-header">
      <span className="wb-brand">Workbench</span>
      <Link className="wb-tool" to="/">Transport review</Link>
      {source && <OpenPullPicker owner={source.owner} repo={source.repo} current={source.kind === "pull" ? source.number : undefined} />}
      {source && <a className="wb-source" href={review ? githubUrl(review) : undefined} target="_blank" rel="noreferrer">{sourceLabel(source)}</a>}
      {review?.headSubject && <span className="wb-title">{review.headSubject}</span>}
      {counts && units.length > 0 && <span className="wb-summary">{units.length} changes · <span className="added">+{counts.added}</span> <span className="removed">−{counts.removed}</span> <span className="changed">~{counts.changed}</span> rows</span>}
      <span className="wb-keys"><kbd>j</kbd>/<kbd>k</kbd> next/previous</span>
    </header>
    {newer && source?.kind === "pull" && <p className="wb-warning wb-newer" role="status">
      This is an older push of the pull request. <Link to={sourcePath({ ...source, range: undefined })}>Open the latest push</Link>
    </p>}
    {error ? <p className="wb-message" role="alert">{error}</p> : !review ? <p className="wb-message" role="status">Loading the review…</p>
      : !units.length ? <p className="wb-message">This diff changes no transport or destination rows.</p> : <div className="wb-body">
      <nav className="wb-units" aria-label="Changes">
        <ol>{units.map((other, i) => <li key={other.id}>
          <button type="button" aria-current={i === index} onClick={() => select(i)}>
            <span className="wb-unit-title">{other.title}</span>
            <span className="wb-unit-meta"><span>{other.file.split("/").at(-1)}:{row(other.changes[0]).line}</span><UnitCounts unit={other} /></span>
          </button>
        </li>)}</ol>
      </nav>
      <main className="wb-main">
        <section className="wb-map">
          {insetPin && overlay ? <Suspense fallback={<div className="route-map" role="status">Loading inset map…</div>}>
            <InsetMap overlay={overlay} focusTile={focusTile} style={style} insets keepFocus onPick={() => {}} onFallback={() => {}}
              onSelectFeatures={keys => setSelectedChange(changeOfKey(unit, keys[0]))} />
          </Suspense> : <p className="wb-message">Insets are not available for these map tiles.</p>}
          {insetPin && styles.length > 1 && <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {styles.map(([id, { label }]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id); saveStyle(id); }}>{label}</button>)}
          </div>}
        </section>
        <section className="wb-detail" aria-label="Rows">
          <h2>{unit.title} <small>{unit.file}</small></h2>
          <RowTable review={review} unit={unit} selected={selectedChange} onSelect={setSelectedChange} onShow={point => setFocusTile({ point })} />
        </section>
      </main>
    </div>}
    <footer className="wb-footer">
      {review && <span>Comparing <a href={`https://github.com/${review.repository}/commit/${review.mergeBase}`}>{short(review.mergeBase)}</a> (merge base)
        → <a href={`https://github.com/${review.repository}/commit/${review.head}`}>{short(review.head)}</a></span>}
      <span>Tiles and collision {tiles.version}</span>
      {/* The pull request's rows are drawn over collision from the tiles release, never from the pull request. */}
      <span className="wb-prov differs" title="Collision comes from the tiles release, not from this pull request">
        Collision dumped by {collisionManifest?.dumperSource ? `${collisionManifest.dumperSource.repository.split("/")[1]}@${collisionManifest.dumperSource.rev.slice(0, 7)}` : "an unknown commit"}
        {collisionManifest?.cacheId !== undefined ? ` from cache ${collisionManifest.cacheId}` : ""}, not from this pull request</span>
      {insetPin && <span>Insets {insetPin.version.slice(0, 12)}</span>}
    </footer>
  </div>;
}

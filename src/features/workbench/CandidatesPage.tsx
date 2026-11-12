import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { insetPin, mapLayers, savedStyle, saveStyle, type MapStyle } from "../../map/layers";
import { featurePoints } from "../../map/insets/features";
import { LayerControl } from "../../map/insets/LayerControl";
import type { WorldBox } from "../../map/insets/projection";
import { loadCollisionManifest, provenance, type CollisionManifest } from "./provenance";
import { pointText } from "./invariants";
import { candidateKinds, connectorText, containsText, filterItems, itemMeta, itemOverlay, kindNames, loadCandidates, partnerText,
  roleNames, type CandidateItem, type CandidateReport } from "./candidates";
import { useUrlLayerSettings, useWorkbenchLayers } from "./WorkbenchLayers";

const InsetMap = lazy(() => import("../../map/insets/InsetMap").then(module => ({ default: module.InsetMap })));
const ITEM_LAYERS = ["collision"];

/**
 * Connections the game shows that the plugin has no transport for, judged live by the service against
 * the plugin it bundles: cache ladders, stairs, cave entrances and world map links that would join a
 * walking area nothing reaches (titled by the world map's name for it), and agility shortcut and
 * dungeon entrance icons with no transport nearby. Adding a row
 * removes its item from the next release's list.
 */
export function CandidatesPage() {
  const location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const query = params.get("q") ?? "", kind = params.get("kind") ?? "";
  const wanted = new URLSearchParams(location.hash.slice(1)).get("item");
  const [report, setReport] = useState<CandidateReport>();
  const [error, setError] = useState("");
  const [manifest, setManifest] = useState<CollisionManifest>();
  const [style, setStyle] = useState(savedStyle);
  const [focusTile, setFocusTile] = useState<{ point: WorldPoint }>();
  useEffect(() => {
    document.title = "Transport candidates · Workbench";
    const abort = new AbortController();
    loadCandidates(abort.signal).then(setReport, reason => { if (!abort.signal.aborted) setError(String(reason)); });
    loadCollisionManifest(abort.signal).then(setManifest, () => {});
    return () => abort.abort();
  }, []);
  const items = useMemo(() => filterItems(report?.items ?? [], query, kind), [report, query, kind]);
  const index = Math.max(0, items.findIndex(item => item.id === wanted));
  const item = items[index];
  const select = (next: number) => {
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    if (target) navigate({ search: location.search, hash: "item=" + target.id });
  };
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value); else next.delete(key);
    navigate({ search: next.toString(), hash: location.hash }, { replace: true });
  };
  useEffect(() => {
    if (item && item.id !== wanted) navigate({ search: location.search, hash: "item=" + item.id }, { replace: true });
  }, [item, wanted, location.search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)
        || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") { event.preventDefault(); select(index + 1); }
      if (event.key === "k") { event.preventDefault(); select(index - 1); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [index, items, location.search]);
  const geometry = useMemo(() => item && itemOverlay(item), [item]);
  const [settings, updateSettings] = useUrlLayerSettings();
  const [inspected, setInspected] = useState<WorldPoint>();
  const [focusBox, setFocusBox] = useState<WorldBox>();
  const layers = useWorkbenchLayers({ settings, update: updateSettings, defaults: ITEM_LAYERS, overlay: geometry, inspected, focus: setFocusBox });
  const collision = layers.collision;
  useEffect(() => {
    if (!geometry) return;
    const abort = new AbortController();
    void collision.load(geometry.anchors.flatMap(featurePoints), 1, abort.signal);
    return () => abort.abort();
  }, [geometry, collision]);
  const count = (name: string) => report?.items.filter(item => item.kind === name).length ?? 0;
  return <div className="wb-page">
    <header className="wb-header">
      <Link className="wb-brand" to="/">Workbench</Link><span className="wb-tool">Transport candidates</span>
      {report && <span className="wb-summary">{candidateKinds.map(k => `${count(k)} ${kindNames[k].toLowerCase()}`).join(" · ")}</span>}
      <span className="wb-keys"><kbd>j</kbd>/<kbd>k</kbd> next/previous</span>
    </header>
    {error ? <p className="wb-message" role="alert">{error}</p> : !report ? <p className="wb-message" role="status">Judging the cache connectors…</p>
      : <div className="wb-body wb-invariants-body">
        <nav className="wb-units" aria-label="Candidates">
          <div className="wb-pad wb-form">
            <p className="wb-note">{report.rule}</p>
            <details className="wb-funnel"><summary>How the list was narrowed</summary>
              <table className="wb-rows"><tbody>{Object.entries(report.funnel).map(([step, n]) => <tr key={step}><th>{step}</th><td>{n.toLocaleString()}</td></tr>)}</tbody></table>
              <p className="wb-note">Snapshot from cache {report.cache}: {Object.entries(report.extraction).map(([step, n]) => `${n.toLocaleString()} ${step}`).join(" · ")}.</p>
              {report.dungeonMarker && <p className="wb-note">Dungeon entrance icon {report.dungeonMarker.field ?? "not found"}:
                {" "}{report.dungeonMarker.iconsNearRows} of its {report.dungeonMarker.icons} placements have a row going down or in within 5 tiles.</p>}
              {report.shortcutMarker && <p className="wb-note">Agility shortcut icon {report.shortcutMarker.field ?? "not found"}:
                {" "}{report.shortcutMarker.iconsNearRows} of its {report.shortcutMarker.icons} placements have a shortcut row within 5 tiles.</p>}
            </details>
            <label>Kind<select aria-label="Kind" value={kind} onChange={e => filter("kind", e.target.value)}>
              <option value="">Everything</option>{candidateKinds.map(k => <option key={k} value={k}>{kindNames[k]} ({count(k)})</option>)}
            </select></label>
            <label>Search candidates<input value={query} placeholder="Object, name, tile or contents" onChange={e => filter("q", e.target.value)} /></label>
            <p className="wb-note" role="status">{items.length} candidates shown</p>
            <div className="wb-inline">
              <button type="button" disabled={!item || index === 0} onClick={() => select(index - 1)}>Previous</button>
              <button type="button" disabled={!item || index === items.length - 1} onClick={() => select(index + 1)}>Next</button>
            </div>
          </div>
          <ol>{items.map((candidate, i) => <li key={candidate.id}><button type="button" aria-current={index === i} onClick={() => select(i)}>
            <span className="wb-unit-title">{candidate.title}</span>
            <span className="wb-unit-meta">{itemMeta(candidate)}</span>
          </button></li>)}</ol>
        </nav>
        <section className="wb-map wb-insets-map" aria-label="Candidate map">
          {geometry && insetPin ? <Suspense fallback={<p className="wb-message">Loading inset map…</p>}>
            <InsetMap inspectCoordinates overlay={layers.overlay} focusTile={focusTile} focusBox={focusBox} style={style} insets
              onPick={point => { layers.clearPick(); setInspected(point); }} onFallback={() => {}}
              onView={layers.onView} onMoveHub={layers.moveHub} onRoutingCrossing={layers.routing.selectCrossing}
              onSelectFeatures={(keys, point) => { if (!layers.pick(keys)) setInspected(point); }} />
          </Suspense> : <p className="wb-message">{item ? "Insets are unavailable for these tiles." : "No candidates match this search."}</p>}
          <div className="map-style-toggle wb-style" role="group" aria-label="Map style">
            {Object.entries(mapLayers).map(([id, layer]) => <button key={id} type="button" aria-pressed={style === id}
              onClick={() => { setStyle(id as MapStyle); saveStyle(id as MapStyle); }}>{layer.label}</button>)}
          </div>
          <div className="wb-finding-legend" aria-label="Geometry legend">
            <span>□ Where the connector is used · ■ Its partner</span>
            <span className="suspect">Dashed box: the unreached area · highlighted: the shortcut or dungeon icon</span>
          </div>
          {insetPin && geometry && <LayerControl layers={layers.layers} onToggle={layers.toggle} />}
        </section>
        <section className="wb-side-panel" aria-label="Candidate details">
          <div className="wb-panel-body">
            {layers.panel}
            {layers.routing.panel && <div className="wb-detail">{layers.routing.panel}</div>}
            {item && <CandidateDetail item={item} show={point => setFocusTile({ point })} />}
            <p className="wb-note">Judged against the service's bundled plugin collision and data; connectors from cache {report.cache}.
              Displayed map collision: tiles {tiles.version}, cache {manifest?.cacheId ?? "unknown"}; its revision may differ.</p>
          </div>
        </section>
      </div>}
    <footer className="wb-footer">
      {provenance(report, manifest).map(line => <span key={line.subject} className={`wb-prov ${line.status}`}><b>{line.subject}</b> {line.text}</span>)}
    </footer>
  </div>;
}

function CandidateDetail({ item, show }: { item: CandidateItem; show(p: WorldPoint): void }) {
  const tile = (point: WorldPoint | null) => <button type="button" className="wb-tile" disabled={!point} onClick={() => point && show(point)}>{pointText(point)}</button>;
  return <article className="wb-section wb-finding-detail" data-item-id={item.id}>
    <h2>{item.title}</h2>
    {item.shortcut && <p>The game's agility shortcut icon at {tile(item.shortcut)} has no transport within 5 tiles.
      {item.shortcut.runelite ? <> RuneLite knows it as <strong>{item.shortcut.description}</strong> ({item.shortcut.runelite}),
        {" "}{item.shortcut.level} Agility.</> : " RuneLite has no shortcut near it."}</p>}
    {item.areaTiles !== null && <p>A walking area of <strong>{item.areaTiles.toLocaleString()} tiles</strong> that no chain of transports
      reaches from Lumbridge{containsText(item) ? <>, holding {containsText(item)}</> : ""}.</p>}
    {item.connectors.length === 0 && <p className="wb-note">No obstacle object found near the icon.</p>}
    {item.connectors.length > 0 && <table className="wb-rows"><thead><tr><th>Connector</th><th>Used from</th><th>Partner</th></tr></thead><tbody>
      {item.connectors.map(c => <tr key={`${c.connector.objectId} ${pointText(c.connector)}`}>
        <td><b>{roleNames[c.role]}</b><div>{connectorText(c.connector)}</div><div className="wb-note">at {pointText(c.connector)}</div></td>
        <td>{tile(c.stand)}</td>
        <td>{c.connector.partner ? <>{partnerText(c.connector)}<div className="wb-note">{c.connector.partner.rule} pair</div>{tile(c.partnerStand)}</> : "—"}</td>
      </tr>)}
    </tbody></table>}
    {item.kind === "dungeon" && <p>The game's dungeon entrance icon at {tile(item.focus)} has no transport within 5 tiles, and no
      world map link beside it. The connectors below are within 5 tiles of the icon.</p>}
    {item.label && <p className="wb-note">The world map names a place in this area: {item.label}.</p>}
    <p className="wb-note">{item.shortcut ? "Obstacles are RuneLite's object ids for the shortcut within 10 tiles of the icon, or else the connectors within 5."
      : <>No transport row starts within 2 tiles of these connectors. A pair is one plane apart (vertical), a neighbouring object id
      about 6,400 tiles away (id+offset), or the world map's link from a dungeon entrance icon to the dungeon (map-link; icon positions,
      so its tiles are the walkable ones nearest each icon).</>}</p>
    <p className="wb-mono">{item.id}</p>
  </article>;
}

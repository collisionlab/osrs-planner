import { useState } from "react";
import type { WorldPoint } from "../../../domain/contracts";
import type { CollisionMap } from "../../../map/insets/collision";
import type { WorldBox } from "../../../map/insets/projection";
import { parseTile, typeName, type Revision, type TransportSummary, type TransportView } from "../transports";
import { tilePoint, tileText, type Area, type InvestigationData, type Triple } from "./data";
import { transportDraft } from "./drafts";
import type { PickTarget } from "./LabellingPanel";
import { key, keyId, keyKind } from "./overlay";
import { copy, download, ExplorerLink, RowLink, Section, TileButton } from "./parts";
import { componentHolds, reasonText, type AreaTopology, type Check, type LinkCandidate, type TopologyReport, type TopologyState } from "./topology";

/** Transports this close to a drafted end, in tiles, are listed as nearby. */
export const NEARBY = 8;
/** A known transport within this many tiles of both drafted ends matches the draft. */
const MATCH = 1;

const near = (a: WorldPoint | null, b: WorldPoint, distance: number) => !!a && a.plane === b.plane && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= distance;
export const nearbyBox = (point: WorldPoint): WorldBox => ({ plane: point.plane, x1: point.x - NEARBY, y1: point.y - NEARBY, x2: point.x + NEARBY, y2: point.y + NEARBY });

/** What is known about a tile, from every source the page has, each said separately. */
export function TileFacts({ point, data, classify, collision, report, verified, nearby }: {
  point: WorldPoint; data: InvestigationData; classify(point: WorldPoint): string; collision?: CollisionMap;
  report?: TopologyReport; verified: boolean; nearby?: TransportSummary[];
}) {
  const regionId = classify(point);
  const region = data.regions.get(regionId);
  const areas = (data.areasOfRegion.get(regionId) || []).map(id => data.byId.get(id)?.name || id);
  const tile = collision?.tile(point);
  const components = report?.components.flatMap(component => { const holds = componentHolds(component, point); return holds ? [{ component, holds }] : []; }) || [];
  const around = nearby?.filter(summary => near(summary.origin, point, NEARBY) || near(summary.destination, point, NEARBY)) || [];
  return <dl className="wb-facts">
    <dt>Tile</dt><dd className="wb-mono">{tileText(point)} (plane {point.plane})</dd>
    <dt>Inset region</dt><dd>{regionId === "main-world" ? "the main map" : region ? <><span className="wb-mono">{regionId}</span> · {region.classification}{areas.length ? ` · ${areas.join(", ")}` : " · in no area"}</> : "no region: no visible terrain here"}</dd>
    <dt>Collision</dt><dd>{!collision ? "not loaded" : !tile ? "no walkable tile in this map square" : tile.blocked ? "blocked: no way in or out"
      : `open ${["north", "east", "south", "west"].filter(side => tile[side as "north"]).join(", ") || "nowhere"}${tile.wallNorth || tile.wallEast ? `; wall on the ${[tile.wallNorth && "north", tile.wallEast && "east"].filter(Boolean).join(" and ")}` : ""}`}</dd>
    <dt>Component</dt><dd>{!report ? "no topology report" : components.length ? components.map(({ component, holds }) =>
      <span key={component.id} className="wb-mono">{component.id}{holds === "bounds" ? " (by its bounds only)" : ""}{component.reachable ? "" : " · unreached"} </span>)
      : "in none the report lists"}{report && !verified && components.length > 0 ? " — unverified" : ""}</dd>
    <dt>Nearby</dt><dd>{nearby === undefined ? "loading…" : around.length ? `${around.length} transport${around.length === 1 ? "" : "s"} within ${NEARBY} tiles` : `no transports within ${NEARBY} tiles`}</dd>
  </dl>;
}

export function TopologyPanel(props: {
  data: InvestigationData; area: Area; state: TopologyState; checks?: { checks: Check[]; verified: boolean };
  topology?: AreaTopology; candidate?: LinkCandidate; item?: string; plugin?: Revision; releasePlugin?: Revision;
  transports?: { view: TransportView; boxes: WorldBox[] }; nearby?: TransportSummary[];
  classify(point: WorldPoint): string; collision?: CollisionMap;
  draft: { origin?: WorldPoint; destination?: WorldPoint }; onDraft(next: { origin?: WorldPoint; destination?: WorldPoint }): void;
  picking?: PickTarget; onPicking(target?: PickTarget): void;
  onItem(key?: string): void; onShow(point: WorldPoint): void; onBox(box: WorldBox): void;
}) {
  const { data, area, state, checks, topology, item, transports } = props;
  const report = state.state === "loaded" ? state.report : undefined;
  const verified = !!checks?.verified;
  const select = (k: string, point?: Triple) => { props.onItem(k); if (point) props.onShow(tilePoint(point)); };
  const regionIds = new Set(area.regionIds);
  const connections = [...new Set(area.regionIds.flatMap(id => data.anchors.regions[id]?.connectionIds || []))]
    .map(id => data.anchors.connections[id]).filter(Boolean);
  const incoming = connections.filter(connection => !regionIds.has(connection.source?.regionId || "") && regionIds.has(connection.target?.regionId || ""));
  const outgoing = connections.filter(connection => regionIds.has(connection.source?.regionId || "") && !regionIds.has(connection.target?.regionId || ""));
  const internal = connections.length - incoming.length - outgoing.length;
  const entrances = area.regionIds.flatMap(id => (data.anchors.regions[id]?.anchors || []).filter(anchor => anchor.entrance && anchor.hops === 1));
  return <div className="wb-panel-body">
    <Section title="Topology report" label="Topology report">
      {state.state === "loading" ? <p className="wb-note">Loading…</p>
        : state.state !== "loaded" ? <p className="wb-unavailable" role="status"><b>{state.state === "invalid" ? "Report rejected" : "Diagnostics unavailable"}:</b> {state.reason} Walking components, candidate links and suspect ends aren't shown; the inset release's own connections below still are.</p>
        : <>
          <ul className="wb-checks">{checks?.checks.map(check => <li key={check.subject} className={check.ok === true ? "ok" : check.ok === false ? "differs" : "unknown"}><b>{check.subject}</b> {check.text}</li>)}</ul>
          {!verified && <p className="wb-warning" role="alert">Unverified: the report was not made from the same data as this page shows, so its conclusions below are leads, not findings.</p>}
          <p className="wb-note"><b>Reachable</b> means: {report!.reachability} It says nothing about requirements, and a reachable component can still have a missing link.</p>
        </>}
    </Section>
    {report && <Section title="Walking components" note={`${topology?.components.length ?? 0} significant${topology?.fragments ? `, ${topology.fragments} small fragment${topology.fragments === 1 ? "" : "s"} not shown` : ""}`}>
      <p className="wb-note">A dungeon is usually several walking components joined by its own doors, ladders and shortcuts. Only a significant component that nothing reaches is a possible gap.</p>
      {topology?.components.length ? <table className="wb-rows"><thead><tr><th>Component</th><th>Plane</th><th>Tiles</th><th>Reached</th><th>In / out</th></tr></thead>
        <tbody>{topology.components.map(({ component, overlap }) => <tr key={component.id} className={item === key.component(component.id) ? "selected" : undefined}
          onClick={() => { props.onItem(key.component(component.id)); const [x1, y1, x2, y2] = component.bounds; props.onBox({ plane: component.plane, x1, y1, x2, y2 }); }}>
          <td className="wb-mono">{component.id}{overlap === "bounds" && <div className="wb-note">bounds overlap only</div>}{!component.mask && <div className="wb-note">no outline: bounds and samples</div>}</td>
          <td>{component.plane}</td><td>{component.tileCount.toLocaleString()}</td>
          <td>{component.reachable ? "yes" : <b className="wb-bad">no</b>}</td><td>{component.transports.incoming} / {component.transports.outgoing}</td>
        </tr>)}</tbody></table> : <p className="wb-note">None on this area's terrain.</p>}
    </Section>}
    {report && <Section title="Candidate links" note={`${topology?.candidates.length ?? 0} in this area`}>
      {topology?.candidates.length ? <ul className="wb-list">{topology.candidates.map(candidate => <li key={candidate.id}>
        <button type="button" className="wb-item" aria-current={item === key.candidate(candidate.id)} onClick={() => select(key.candidate(candidate.id), candidate.from.point)}>
          <span className="wb-mono">{tileText(candidate.from.point)} → {tileText(candidate.to.point)}</span>
          <span className={`wb-support ${candidate.support}`}>{candidate.support === "supported" ? "supported" : "insufficient evidence"}</span>
        </button></li>)}</ul> : <p className="wb-note">None.</p>}
      {props.candidate && <CandidateDetail {...props} candidate={props.candidate} verified={verified} />}
    </Section>}
    {report && <Section title="Suspicious transport ends" note={`${topology?.suspects.length ?? 0}`}>
      {topology?.suspects.length ? <ul className="wb-list">{topology.suspects.map(suspect => <li key={suspect.id} className={item === key.suspect(suspect.id) ? "selected" : undefined}>
        <button type="button" className="wb-link" onClick={() => select(key.suspect(suspect.id), suspect.point)}>{suspect.label}</button> <span className="wb-note">{suspect.role} {tileText(suspect.point)}</span>
        <div className="wb-note">{suspect.reasons.map(reasonText).join(" ")}</div>
        <div>{suspect.sources.map(source => <span key={source.line}><RowLink plugin={report.plugin} file={source.file} line={source.line} /> </span>)} <ExplorerLink point={suspect.point} /></div>
      </li>)}</ul> : <p className="wb-note">None.</p>}
    </Section>}
    <Section title="Entrances and connections" note="matched by the inset release">
      <p className="wb-note">{entrances.length} surface entrance tile{entrances.length === 1 ? "" : "s"} · {incoming.length} in · {outgoing.length} out · {internal} within the area.
        {props.releasePlugin ? "" : " Row links open the explorer's plugin commit; the release only records its transports' hash, so lines may have moved."}</p>
      <ConnectionTable title="Incoming" rows={incoming} plugin={props.releasePlugin ?? props.plugin} onShow={props.onShow} />
      <ConnectionTable title="Outgoing" rows={outgoing} plugin={props.releasePlugin ?? props.plugin} onShow={props.onShow} />
    </Section>
    <Section title="Transports here" note="from the explorer's catalogue">
      {!transports ? <p className="wb-note">Loading…</p> : transports.view.clusters.length ? <p className="wb-note">{transports.view.total.toLocaleString()} transports, too many to draw; open the explorer to list them.</p>
        : <ul className="wb-list wb-compact">{transports.view.transports.slice(0, 60).map(summary => <li key={summary.id} className={item === key.transport(summary.id) ? "selected" : undefined}>
          <button type="button" className="wb-link" onClick={() => { props.onItem(key.transport(summary.id)); props.onShow(summary.origin || summary.destination); }}>{summary.label || typeName(summary.type)}</button>
          {" "}<span className="wb-note wb-mono">{summary.origin ? tileText(summary.origin) : "anywhere"} → {tileText(summary.destination)}</span> <ExplorerLink id={summary.id}>explorer ↗</ExplorerLink>
        </li>)}{transports.view.transports.length > 60 && <li className="wb-note">and {transports.view.transports.length - 60} more</li>}</ul>}
    </Section>
    <LinkInvestigator {...props} verified={verified} report={report} />
  </div>;
}

function ConnectionTable({ title, rows, plugin, onShow }: { title: string; rows: InvestigationData["anchors"]["connections"][string][]; plugin?: Revision; onShow(point: WorldPoint): void }) {
  if (!rows.length) return null;
  return <table className="wb-rows wb-sources" aria-label={`${title} connections`}><thead><tr><th>{title}</th><th>From → to</th><th>Row</th></tr></thead>
    <tbody>{rows.slice(0, 40).map(connection => <tr key={connection.id}>
      <td>{connection.action || connection.label || connection.reason}<div className="wb-note">{connection.policy}{connection.policy === "review" ? `: ${connection.reason}` : ""}</div></td>
      <td>{connection.source ? <TileButton point={connection.source.point} onShow={onShow} /> : <i>anywhere</i>} → {connection.target ? <TileButton point={connection.target.point} onShow={onShow} /> : <i>?</i>}</td>
      <td>{connection.sources.map((source, index) => source.line ? <span key={index}><RowLink plugin={plugin} file={source.file} line={source.line} /> </span> : <span key={index} className="wb-note">{source.file} </span>)}
        {connection.source && <ExplorerLink point={connection.source.point}>explorer ↗</ExplorerLink>}</td>
    </tr>)}{rows.length > 40 && <tr><td colSpan={3} className="wb-note">and {rows.length - 40} more</td></tr>}</tbody></table>;
}

function CandidateDetail(props: Parameters<typeof TopologyPanel>[0] & { candidate: LinkCandidate; verified: boolean }) {
  const { candidate, data, classify, nearby } = props;
  const report = props.state.state === "loaded" ? props.state.report : undefined;
  const from = tilePoint(candidate.from.point), to = tilePoint(candidate.to.point);
  const known = (nearby || []).filter(summary => near(summary.origin, from, NEARBY) || near(summary.destination, from, NEARBY) || near(summary.origin, to, NEARBY) || near(summary.destination, to, NEARBY));
  const regionName = (point: WorldPoint) => { const id = classify(point); return id === "main-world" ? "main map" : (data.areasOfRegion.get(id) || []).map(area => data.byId.get(area)?.name).join(", ") || id; };
  return <div className="wb-callout" role="region" aria-label="Selected candidate">
    <h4>Candidate {candidate.id} <span className={`wb-support ${candidate.support}`}>{candidate.support === "supported" ? "supported" : "insufficient evidence"}</span>{!props.verified && <span className="wb-support insufficient">unverified report</span>}</h4>
    <dl className="wb-facts">
      <dt>From</dt><dd><TileButton point={from} onShow={props.onShow} /> plane {from.plane} · {regionName(from)}{candidate.from.componentId && <span className="wb-mono"> · {candidate.from.componentId}</span>}</dd>
      <dt>To</dt><dd><TileButton point={to} onShow={props.onShow} /> plane {to.plane} · {regionName(to)}{candidate.to.componentId && <span className="wb-mono"> · {candidate.to.componentId}</span>}</dd>
      <dt>Reasons</dt><dd>{candidate.reasons.length ? candidate.reasons.map(code => <div key={code}><span className="wb-mono">{code}</span> {reasonText(code) !== code && `— ${reasonText(code)}`}</div>) : <i>none given</i>}</dd>
      <dt>Evidence</dt><dd>{candidate.evidence.length ? candidate.evidence.map((evidence, index) => <div key={index}>
        <b>{evidence.kind}</b> {evidence.text}{evidence.point && <> · <TileButton point={evidence.point} onShow={props.onShow} /></>}
        {evidence.source && report && <> · <RowLink plugin={report.plugin} file={evidence.source.file} line={evidence.source.line} /></>}</div>)
        : <i>none: this is a lead to check in game, not a finding</i>}</dd>
      <dt>Rows</dt><dd>{candidate.sources.length ? candidate.sources.map(source => <span key={source.file + source.line}><RowLink plugin={report?.plugin} file={source.file} line={source.line} /> </span>) : "none"}</dd>
      <dt>Known nearby</dt><dd>{nearby === undefined ? "loading…" : known.length ? known.slice(0, 12).map(summary => <div key={summary.id}>
        <ExplorerLink id={summary.id}>{summary.label || typeName(summary.type)}</ExplorerLink> <span className="wb-note wb-mono">{summary.origin ? tileText(summary.origin) : "anywhere"} → {tileText(summary.destination)}</span></div>)
        : `no transports within ${NEARBY} tiles of either end`}</dd>
    </dl>
    <button type="button" className="wb-small" onClick={() => props.onDraft({ origin: from, destination: to })}>Investigate as a new link</button>
  </div>;
}

function LinkInvestigator(props: Parameters<typeof TopologyPanel>[0] & { verified: boolean; report?: TopologyReport }) {
  const { draft, onDraft, picking, onPicking, nearby } = props;
  const [text, setText] = useState<{ origin: string; destination: string }>({ origin: "", destination: "" });
  const [notes, setNotes] = useState({ action: "", objectId: "" });
  const [copied, setCopied] = useState(false);
  const set = (end: "origin" | "destination", value: string) => {
    setText(current => ({ ...current, [end]: value }));
    const point = parseTile(value);
    if (point) onDraft({ ...draft, [end]: point });
  };
  const matches = draft.origin && draft.destination ? (nearby || []).filter(summary => near(summary.origin, draft.origin!, MATCH) && near(summary.destination, draft.destination!, MATCH)) : [];
  const reverse = draft.origin && draft.destination ? (nearby || []).filter(summary => near(summary.origin, draft.destination!, MATCH) && near(summary.destination, draft.origin!, MATCH)) : [];
  const spec = draft.origin && draft.destination ? transportDraft(draft.origin, draft.destination, notes) : undefined;
  const end = (which: "origin" | "destination") => <div className="wb-end">
    <div className="wb-inline"><b>{which === "origin" ? "Origin" : "Destination"}</b>
      <input aria-label={`${which} tile`} className="wb-mono" placeholder="x y plane" value={draft[which] && !text[which] ? tileText(draft[which]!) : text[which]} onChange={event => set(which, event.target.value)} />
      <button type="button" className="wb-small" aria-pressed={picking === which} aria-label={`Pick the ${which} on the map`} onClick={() => onPicking(picking === which ? undefined : which)}>{picking === which ? "Click the map…" : "Pick on map"}</button>
      {draft[which] && <TileButton point={draft[which]!} onShow={props.onShow} label="show" />}
    </div>
    {draft[which] && <TileFacts point={draft[which]!} data={props.data} classify={props.classify} collision={props.collision} report={props.report} verified={props.verified} nearby={nearby} />}
  </div>;
  return <Section title="Investigate a new link" note="evidence gathering; nothing is written">
    {end("origin")}{end("destination")}
    {spec && <>
      <p className={matches.length ? "wb-warning" : "wb-note"} role="status">{matches.length
        ? <>Already known: {matches.map(summary => <ExplorerLink key={summary.id} id={summary.id}>{summary.label || typeName(summary.type)} </ExplorerLink>)}</>
        : nearby === undefined ? "Checking known transports…" : `No known transport joins these tiles (within ${MATCH} tile).`}
        {reverse.length > 0 && <> The other way is known: {reverse.map(summary => <ExplorerLink key={summary.id} id={summary.id}>{summary.label || typeName(summary.type)} </ExplorerLink>)}</>}</p>
      <div className="wb-form" role="group" aria-label="What you saw">
        <label>Menu option and target, if seen <input value={notes.action} placeholder="e.g. Climb-down Ladder" onChange={event => { setCopied(false); setNotes({ ...notes, action: event.target.value }); }} /></label>
        <label>Object id, if known <input className="wb-mono" value={notes.objectId} onChange={event => { setCopied(false); setNotes({ ...notes, objectId: event.target.value }); }} /></label>
      </div>
      <p className="wb-note">Still to investigate: {spec.unknown.join(", ")}. Nothing is filled in for you; the row won't pass review until they are.</p>
      <pre className="wb-draft-text" aria-label="Transport draft">{spec.tsv}</pre>
      <div className="wb-inline">
        <button type="button" className="wb-small" onClick={() => void copy(spec.tsv).then(setCopied)}>{copied ? "Copied" : "Copy row"}</button>
        <button type="button" className="wb-small" onClick={() => download("candidate-transport.tsv", spec.tsv, "text/tab-separated-values")}>Download</button>
        <button type="button" className="wb-small" onClick={() => { onDraft({}); setText({ origin: "", destination: "" }); }}>Clear</button>
      </div>
    </>}
  </Section>;
}


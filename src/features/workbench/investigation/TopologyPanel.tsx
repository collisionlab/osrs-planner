import { useState } from "react";
import type { WorldPoint } from "../../../domain/contracts";
import type { CollisionMap } from "../../../map/insets/collision";
import type { WorldBox } from "../../../map/insets/projection";
import { parseTile, typeName, type Revision, type TransportSummary } from "../transports";
import { tileText, type Area, type InvestigationData } from "./data";
import { transportDraft } from "./drafts";
import type { PickTarget } from "./LabellingPanel";
import { copy, download, ExplorerLink, RowLink, Section, TileButton } from "./parts";

/** Transports this close to a drafted end, in tiles, are listed as nearby. */
export const NEARBY = 8;
/** A known transport within this many tiles of both drafted ends matches the draft. */
const MATCH = 1;

const near = (a: WorldPoint | null, b: WorldPoint, distance: number) => !!a && a.plane === b.plane && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= distance;
export const nearbyBox = (point: WorldPoint): WorldBox => ({ plane: point.plane, x1: point.x - NEARBY, y1: point.y - NEARBY, x2: point.x + NEARBY, y2: point.y + NEARBY });

/** What is known about a tile, from every source the page has, each said separately. */
export function TileFacts({ point, data, classify, collision, nearby }: {
  point: WorldPoint; data: InvestigationData; classify(point: WorldPoint): string; collision?: CollisionMap; nearby?: TransportSummary[];
}) {
  const regionId = classify(point);
  const region = data.regions.get(regionId);
  const areas = (data.areasOfRegion.get(regionId) || []).map(id => data.byId.get(id)?.name || id);
  const tile = collision?.tile(point);
  const around = nearby?.filter(summary => near(summary.origin, point, NEARBY) || near(summary.destination, point, NEARBY)) || [];
  return <dl className="wb-facts">
    <dt>Tile</dt><dd className="wb-mono">{tileText(point)} (plane {point.plane})</dd>
    <dt>Inset region</dt><dd>{regionId === "main-world" ? "the main map" : region ? <><span className="wb-mono">{regionId}</span> · {region.classification}{areas.length ? ` · ${areas.join(", ")}` : " · in no area"}</> : "no region: no visible terrain here"}</dd>
    <dt>Collision</dt><dd>{!collision ? "not loaded" : !tile ? "no walkable tile in this map square" : tile.blocked ? "blocked: no way in or out"
      : `open ${["north", "east", "south", "west"].filter(side => tile[side as "north"]).join(", ") || "nowhere"}${tile.wallNorth || tile.wallEast ? `; wall on the ${[tile.wallNorth && "north", tile.wallEast && "east"].filter(Boolean).join(" and ")}` : ""}`}</dd>
    <dt>Nearby</dt><dd>{nearby === undefined ? "loading…" : around.length ? `${around.length} transport${around.length === 1 ? "" : "s"} within ${NEARBY} tiles` : `no transports within ${NEARBY} tiles`}</dd>
  </dl>;
}

export function TopologyPanel(props: {
  data: InvestigationData; area: Area; plugin?: Revision; releasePlugin?: Revision;
  nearby?: TransportSummary[];
  classify(point: WorldPoint): string; collision?: CollisionMap;
  draft: { origin?: WorldPoint; destination?: WorldPoint }; onDraft(next: { origin?: WorldPoint; destination?: WorldPoint }): void;
  picking?: PickTarget; onPicking(target?: PickTarget): void;
  onShow(point: WorldPoint): void;
}) {
  const { data, area } = props;
  const regionIds = new Set(area.regionIds);
  const connections = [...new Set(area.regionIds.flatMap(id => data.anchors.regions[id]?.connectionIds || []))]
    .map(id => data.anchors.connections[id]).filter(Boolean);
  const incoming = connections.filter(connection => !regionIds.has(connection.source?.regionId || "") && regionIds.has(connection.target?.regionId || ""));
  const outgoing = connections.filter(connection => regionIds.has(connection.source?.regionId || "") && !regionIds.has(connection.target?.regionId || ""));
  const entrances = area.regionIds.flatMap(id => (data.anchors.regions[id]?.anchors || []).filter(anchor => anchor.entrance && anchor.hops === 1));
  return <div className="wb-panel-body">
    <Section title="Connections" note={`${entrances.length} surface entrance${entrances.length === 1 ? "" : "s"}`}>
      <ConnectionList title="Ways in" rows={incoming} plugin={props.releasePlugin ?? props.plugin} onShow={props.onShow} />
      <ConnectionList title="Ways out" rows={outgoing} plugin={props.releasePlugin ?? props.plugin} onShow={props.onShow} />
      {!incoming.length && !outgoing.length && <p className="wb-note">No known way in or out.</p>}
      {(incoming[0] || outgoing[0])?.source && <p><ExplorerLink point={(incoming[0] || outgoing[0]).source!.point}>Open in the transport explorer ↗</ExplorerLink></p>}
    </Section>
    <details className="wb-more-detail wb-investigate">
      <summary>Investigate a new link</summary>
      <LinkInvestigator {...props} />
    </details>
  </div>;
}
function ConnectionList({ title, rows, plugin, onShow }: { title: string; rows: InvestigationData["anchors"]["connections"][string][]; plugin?: Revision; onShow(point: WorldPoint): void }) {
  if (!rows.length) return null;
  return <section aria-label={title}>
    <h4>{title} <small>{rows.length}</small></h4>
    <ul className="wb-list wb-compact">{rows.slice(0, 40).map(connection => <li key={connection.id} title={connection.policy === "review" ? connection.reason : undefined}>
      {connection.action || connection.label || connection.reason}{" "}
      <span className="wb-mono">{connection.source ? <TileButton point={connection.source.point} onShow={onShow} /> : <i>anywhere</i>} → {connection.target ? <TileButton point={connection.target.point} onShow={onShow} /> : <i>?</i>}</span>
      {" "}{connection.sources.filter(source => source.line).slice(0, 1).map(source => <RowLink key={source.file + source.line} plugin={plugin} file={source.file} line={source.line} />)}
    </li>)}{rows.length > 40 && <li className="wb-note">and {rows.length - 40} more</li>}</ul>
  </section>;
}

function LinkInvestigator(props: Parameters<typeof TopologyPanel>[0]) {
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
    {draft[which] && <TileFacts point={draft[which]!} data={props.data} classify={props.classify} collision={props.collision} nearby={nearby} />}
  </div>;
  return <section className="wb-section" aria-label="Investigate a new link">
    <p className="wb-note">Gather evidence for a missing link; nothing is written anywhere.</p>
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
  </section>;
}


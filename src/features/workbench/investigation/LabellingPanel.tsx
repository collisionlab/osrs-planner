import { useMemo, useState } from "react";
import type { WorldPoint } from "../../../domain/contracts";
import type { Revision } from "../transports";
import { evidenceOf, tileText, type Area, type InvestigationData } from "./data";
import { areaKey, correctionDraft, type CorrectionInput } from "./drafts";
import { key, keyId, keyKind } from "./overlay";
import { copy, download, Kind, RowLink, Section, TileButton } from "./parts";

export type PickTarget = "origin" | "destination" | "seed" | "anchor";

export function emptyCorrection(area: Area | undefined, regionId: string | undefined): CorrectionInput {
  const named = area && area.status !== "provisional";
  return { key: named && area.areaKey ? area.areaKey : "", name: named ? area.name : "", status: area?.status === "descriptive" ? "descriptive" : "named",
    regionId, evidence: [], justification: "" };
}

export function LabellingPanel({ data, area, region, item, plugin, onItem, onShow, onRegion, onArea, correction, onCorrection, picking, onPicking, shows }: {
  data: InvestigationData;
  area: Area;
  region?: string;
  item?: string;
  plugin?: Revision;
  onItem(key?: string): void;
  onShow(point: WorldPoint): void;
  onRegion(regionId: string): void;
  onArea(areaId: string): void;
  correction: CorrectionInput;
  onCorrection(next: CorrectionInput): void;
  picking?: PickTarget;
  onPicking(target?: PickTarget): void;
  /** Whether a tile is on terrain the map shows. */
  shows(point: WorldPoint): boolean;
}) {
  const regionIds = area.regionIds;
  const selectedRegion = region && regionIds.includes(region) ? region : undefined;
  const entries = (selectedRegion ? [selectedRegion] : regionIds).flatMap(id => (data.labels[id]?.areas || []).map(entry => ({ regionId: id, entry })));
  // Evidence accepted for the area, once each, with the regions that cite it.
  const accepted = useMemo(() => {
    const cited = new Map<string, string[]>();
    for (const { regionId, entry } of entries) for (const id of entry.evidence) cited.set(id, [...cited.get(id) || [], regionId]);
    return [...cited];
  }, [entries]);
  const selectedEvidence = keyKind(item) === "ev" ? evidenceOf(data, keyId(item!)) : undefined;
  const offerable = [...new Set([...accepted.map(([id]) => id), ...area.candidates.flatMap(candidate => candidate.evidence)])];
  return <div className="wb-panel-body">
    <Section title="Area" note={<Kind />}>
      <dl className="wb-facts">
        <dt>Name</dt><dd><b>{area.name}</b> <span className={`wb-status ${area.status}`}>{area.status}</span></dd>
        <dt>Area key</dt><dd className="wb-mono">{area.areaKey || <i>none: not curated</i>}</dd>
        <dt>Aliases</dt><dd>{area.aliases.length ? area.aliases.join(", ") : "none"}</dd>
        <dt>Planes</dt><dd>{area.planes.join(", ")} · {area.tileCount.toLocaleString()} tiles</dd>
      </dl>
    </Section>
    <Section title="Regions" note={`${regionIds.length} in this area`}>
      <table className="wb-rows"><thead><tr><th>Region</th><th>Plane</th><th>Status</th><th>Tiles</th><th>Anchor</th></tr></thead>
        <tbody>{regionIds.map(id => {
          const shape = data.regions.get(id), label = data.labels[id], anchors = data.anchors.regions[id];
          return <tr key={id} className={id === selectedRegion ? "selected" : undefined} onClick={() => onRegion(id)}>
            <td className="wb-mono">{id}</td><td>{shape?.plane}</td><td>{label?.status}</td><td>{shape?.tileCount.toLocaleString()}</td>
            <td>{anchors?.anchors.length ? anchors.anchors.some(anchor => anchor.entrance) ? "entrance" : "placed only" : <i>unknown</i>}</td>
          </tr>;
        })}</tbody></table>
    </Section>
    {entries.length > 0 && <Section title="Accepted labels" note={<Kind />}>
      {entries.map(({ regionId, entry }) => <div key={regionId + entry.areaKey} className="wb-entry">
        <div><b>{entry.name}</b> <span className="wb-mono">{regionId}</span> · seed <TileButton point={entry.seed} onShow={onShow} /></div>
        <p className="wb-note">{entry.reason || "No reason recorded."}</p>
      </div>)}
    </Section>}
    <Section title="Evidence" note={<>accepted for {selectedRegion ? "this region" : "the area"} <Kind /></>}>
      {accepted.length ? <table className="wb-rows"><thead><tr><th>Evidence</th><th>Name</th><th>Coordinate</th><th>Source</th></tr></thead>
        <tbody>{accepted.map(([id]) => {
          const record = evidenceOf(data, id);
          return <tr key={id} className={item === key.evidence(id) ? "selected" : undefined} onClick={() => { onItem(key.evidence(id)); if (record) onShow({ x: record.point[0], y: record.point[1], plane: record.point[2] }); }}>
            <td className="wb-mono">{id}</td><td>{record ? record.name : <i>missing from the release</i>} {record && <small className="wb-note">{record.kind}</small>}</td>
            <td className="wb-mono">{record ? tileText(record.point) : "—"}</td>
            <td>{record?.url ? <a href={record.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{record.source}</a> : <span className="wb-note">{record?.source}{record?.row !== undefined ? ` row ${record.row}` : ""}</span>}</td>
          </tr>;
        })}</tbody></table> : <p className="wb-note">No accepted evidence.</p>}
      {selectedEvidence && <div className="wb-callout" role="note" aria-label="Selected evidence">
        <b>{selectedEvidence.name}</b> ({selectedEvidence.accepted ? "accepted" : "suggested"}, {selectedEvidence.kind}) — source coordinate <span className="wb-mono">{tileText(selectedEvidence.point)}</span>.{" "}
        {shows({ x: selectedEvidence.point[0], y: selectedEvidence.point[1], plane: selectedEvidence.point[2] }) ? "Marked on the map." : "It is not on terrain shown here; source positions are not always walkable tiles."}
      </div>}
    </Section>
    <Section title="Name candidates" note={<Kind suggestion />}>
      {data.investigations.state !== "loaded" ? <p className="wb-note">Unavailable: {data.investigations.reason}</p>
        : area.candidates.length ? <ul className="wb-list">{area.candidates.map(candidate => <li key={candidate.id}>
          <b>{candidate.name}</b> for <button type="button" className="wb-link" onClick={() => onRegion(candidate.regionId)}>{candidate.regionId}</button>
          {candidate.score !== undefined && <small className="wb-note"> score {candidate.score}</small>}
          <div className="wb-note">{candidate.reason}</div>
          <div>{candidate.evidence.map(id => { const record = evidenceOf(data, id); return <button key={id} type="button" className="wb-chip"
            aria-pressed={item === key.evidence(id)} onClick={() => { onItem(key.evidence(id)); if (record) onShow({ x: record.point[0], y: record.point[1], plane: record.point[2] }); }}>
            {record?.name || id} <span className="wb-mono">{record ? tileText(record.point) : "?"}</span></button>; })}</div>
        </li>)}</ul> : <p className="wb-note">None suggested.</p>}
    </Section>
    <Section title="Anchors and entrance chains" note={<Kind />}>
      {(selectedRegion ? [selectedRegion] : regionIds).map(id => {
        const entry = data.anchors.regions[id];
        if (!entry?.anchors.length) return <p key={id} className="wb-note"><span className="wb-mono">{id}</span>: placement unknown. No anchor or entrance is known, so the map shows it where it really is.</p>;
        return <div key={id} className="wb-entry"><div className="wb-mono">{id}</div><ol className="wb-chain">
          {entry.anchors.slice(0, 8).map((anchor, index) => <li key={index} className={index === (entry.defaultAnchor ?? 0) ? "default" : undefined}>
            <TileButton point={anchor.point} onShow={onShow} /> {anchor.entrance ? "entrance" : "places only"}{anchor.curated ? " · curated" : ""} · {anchor.hops} hop{anchor.hops === 1 ? "" : "s"}
            {index === (entry.defaultAnchor ?? 0) && <b> · default</b>}
            <div className="wb-note">{anchor.path.map(step => { const connection = data.anchors.connections[step.connectionId];
              return <span key={step.connectionId} className="wb-step">{connection?.action || connection?.label || step.connectionId}{step.reversed ? " (back)" : ""}
                {connection?.sources.filter(source => source.line).map(source => <span key={source.line}> <RowLink plugin={plugin} file={source.file} line={source.line} /></span>)}</span>; })}</div>
          </li>)}
          {entry.anchors.length > 8 && <li className="wb-note">and {entry.anchors.length - 8} more</li>}
        </ol></div>;
      })}
    </Section>
    <Section title="Related areas" note={data.investigations.state === "loaded" ? "from the worklist" : "joined by the release's connections"}>
      {area.relatedAreaIds.length ? <div>{area.relatedAreaIds.map(id => <button key={id} type="button" className="wb-chip" onClick={() => onArea(id)}>{data.byId.get(id)?.name || id}</button>)}</div>
        : <p className="wb-note">None.</p>}
    </Section>
    <Section title="Outstanding issues">
      {area.issues.length ? <ul className="wb-list">{area.issues.map((issue, index) => <li key={index} className={`wb-issue ${issue.severity}`}>
        <b>{issue.code}</b> <small className="wb-note">{issue.severity} · {issue.source}</small> {issue.message}
        {issue.regionId && <> <button type="button" className="wb-link" onClick={() => onRegion(issue.regionId!)}>{issue.regionId}</button></>}
        {issue.point && <> <TileButton point={issue.point} onShow={onShow} /></>}
      </li>)}</ul> : <p className="wb-note">None recorded.</p>}
    </Section>
    <CorrectionForm data={data} area={area} correction={correction} onCorrection={onCorrection} offerable={offerable} picking={picking} onPicking={onPicking} />
  </div>;
}

function CorrectionForm({ data, area, correction, onCorrection, offerable, picking, onPicking }: {
  data: InvestigationData; area: Area; correction: CorrectionInput; onCorrection(next: CorrectionInput): void;
  offerable: string[]; picking?: PickTarget; onPicking(target?: PickTarget): void;
}) {
  const [copied, setCopied] = useState(false);
  const set = (next: Partial<CorrectionInput>) => { setCopied(false); onCorrection({ ...correction, ...next }); };
  const { draft, problems } = correctionDraft(correction, data.regions);
  const text = draft ? JSON.stringify({ draft: "annotations.json area entry", release: data.assets.manifest.version, area: draft }, null, 2) : "";
  const [extra, setExtra] = useState("");
  const evidenceIds = [...new Set([...offerable, ...correction.evidence])];
  const pickButton = (target: PickTarget) => <button type="button" className="wb-small" aria-pressed={picking === target} aria-label={`Pick the ${target === "seed" ? "seed tile" : "anchor point"} on the map`}
    onClick={() => onPicking(picking === target ? undefined : target)}>
    {picking === target ? "Click the map…" : "Pick on map"}</button>;
  return <Section title="Prepare a correction" note="a draft to copy; nothing is written">
    <div className="wb-form" role="group" aria-label="Correction draft">
      <label>Name <input value={correction.name} onChange={event => set({ name: event.target.value, key: correction.key && correction.key !== areaKey(correction.name) ? correction.key : areaKey(event.target.value) })} /></label>
      <label>Area key <input className="wb-mono" value={correction.key} onChange={event => set({ key: event.target.value })} /></label>
      <label>Status <select value={correction.status} onChange={event => set({ status: event.target.value as CorrectionInput["status"] })}><option value="named">named</option><option value="descriptive">descriptive</option></select></label>
      <label>Region <select value={correction.regionId || ""} onChange={event => set({ regionId: event.target.value || undefined })}>
        <option value="">choose…</option>{area.regionIds.map(id => <option key={id} value={id}>{id} (plane {data.regions.get(id)?.plane})</option>)}</select></label>
      <div className="wb-field"><span>Seed tile</span> <span className="wb-inline"><span className="wb-mono">{correction.seed ? tileText(correction.seed) : "none"}</span>{pickButton("seed")}</span></div>
      <fieldset><legend>Evidence</legend>
        {evidenceIds.map(id => { const record = evidenceOf(data, id); return <label key={id} className="wb-check">
          <input type="checkbox" checked={correction.evidence.includes(id)} onChange={event => set({ evidence: event.target.checked ? [...correction.evidence, id] : correction.evidence.filter(other => other !== id) })} />
          <span className="wb-mono">{id}</span> {record?.name}{record && !record.accepted && <small className="wb-note"> (suggested)</small>}</label>; })}
        <span className="wb-inline"><input aria-label="Another evidence id" className="wb-mono" placeholder="s-… or c-…" value={extra} onChange={event => setExtra(event.target.value.trim())} />
          <button type="button" className="wb-small" disabled={!extra || !evidenceOf(data, extra)} onClick={() => { set({ evidence: [...new Set([...correction.evidence, extra])] }); setExtra(""); }}>Add</button></span>
      </fieldset>
      <label>Justification <textarea rows={3} value={correction.justification} onChange={event => set({ justification: event.target.value })} /></label>
      <fieldset><legend>Curated anchor (optional)</legend>
        <span className="wb-inline"><span className="wb-mono">{correction.anchor?.point ? tileText(correction.anchor.point) : "none"}</span>{pickButton("anchor")}
          {correction.anchor && <button type="button" className="wb-small" onClick={() => set({ anchor: undefined })}>Clear</button>}</span>
        <label>Reason <input value={correction.anchor?.reason || ""} onChange={event => set({ anchor: { entrance: false, ...correction.anchor, reason: event.target.value } })} /></label>
        <label className="wb-check"><input type="checkbox" checked={!!correction.anchor?.entrance} onChange={event => set({ anchor: { reason: "", ...correction.anchor, entrance: event.target.checked } })} /> The point is where a player goes in</label>
      </fieldset>
    </div>
    {problems.length > 0 && <ul className="wb-problems" aria-label="Draft problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
    {draft && <>
      <pre className="wb-draft-text" aria-label="Annotation draft">{text}</pre>
      <div className="wb-inline">
        <button type="button" className="wb-small" onClick={() => void copy(text).then(setCopied)}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="wb-small" onClick={() => download(`${draft.key}.annotation.json`, text, "application/json")}>Download</button>
      </div>
    </>}
  </Section>;
}

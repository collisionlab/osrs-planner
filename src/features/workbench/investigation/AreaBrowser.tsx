import { useMemo } from "react";
import { filterAreas, hasTopologyGap, type Area, type AreaFilter, type AreaStatus } from "./data";

/** Listed at most; filters narrow the rest. */
const LISTED = 300;
const SIZES = [0, 50, 200, 1000, 10000];

export function AreaBrowser({ areas, filter, onFilter, selected, onSelect, gaps, ordered }: {
  areas: Area[];
  filter: AreaFilter;
  onFilter(filter: AreaFilter): void;
  selected?: string;
  onSelect(area: Area): void;
  /** Areas the topology report finds a possible gap in, when it is loaded and trusted. */
  gaps?: Set<string>;
  /** How the order was decided, in words. */
  ordered: string;
}) {
  const matches = useMemo(() => filterAreas(areas, filter, gaps), [areas, filter, gaps]);
  const set = (next: Partial<AreaFilter>) => onFilter({ ...filter, ...next });
  return <nav className="wb-units wb-explorer-side" aria-label="Areas">
    <form className="wb-search" role="search" onSubmit={event => event.preventDefault()}>
      <input aria-label="Search areas" placeholder="Name, area key or region id" value={filter.text || ""} onChange={event => set({ text: event.target.value || undefined })} />
    </form>
    <div className="wb-area-filters">
      <label>Status <select aria-label="Status" value={filter.status || ""} onChange={event => set({ status: (event.target.value || undefined) as AreaStatus | undefined })}>
        <option value="">any</option><option value="named">named</option><option value="descriptive">descriptive</option><option value="provisional">provisional</option>
      </select></label>
      <label>Plane <select aria-label="Plane" value={filter.plane ?? ""} onChange={event => set({ plane: event.target.value === "" ? undefined : Number(event.target.value) })}>
        <option value="">any</option>{[0, 1, 2, 3].map(plane => <option key={plane} value={plane}>{plane}</option>)}
      </select></label>
      <label>Size <select aria-label="Size" value={filter.minTiles ?? 0} onChange={event => set({ minTiles: Number(event.target.value) || undefined })}>
        {SIZES.map(size => <option key={size} value={size}>{size ? `≥ ${size.toLocaleString()} tiles` : "any"}</option>)}
      </select></label>
      <label>Show <select aria-label="Outstanding" value={filter.flag || ""} onChange={event => set({ flag: (event.target.value || undefined) as AreaFilter["flag"] })}>
        <option value="">all areas</option><option value="issues">with issues</option><option value="no-entrance">no known entrance</option>
        <option value="multi-floor">multi-floor</option><option value="evidence">name candidates or evidence issues</option>
        <option value="topology">possible topology gaps</option>
      </select></label>
    </div>
    <p className="wb-list-heading" role="status">{matches.length.toLocaleString()} of {areas.length.toLocaleString()} areas · {ordered}</p>
    <ol>{matches.slice(0, LISTED).map(area => <li key={area.id}>
      <button type="button" aria-current={area.id === selected} onClick={() => onSelect(area)}>
        <span className="wb-unit-title">{area.name}</span>
        <span className="wb-unit-meta">
          <span>{area.status} · {area.regionIds.length} region{area.regionIds.length === 1 ? "" : "s"} · plane{area.planes.length > 1 ? "s" : ""} {area.planes.join(",")}</span>
          <span className="wb-counts">
            {!area.entrance && <span className="wb-flag" title="No known entrance">no entrance</span>}
            {hasTopologyGap(area, gaps) && <span className="wb-flag gap" title="Possible topology gap">gap</span>}
            {area.issues.length > 0 && <span className="wb-flag issue" title={area.issues.map(issue => issue.message).join("\n")}>{area.issues.length} issue{area.issues.length === 1 ? "" : "s"}</span>}
          </span>
        </span>
      </button>
    </li>)}</ol>
    {matches.length > LISTED && <p className="wb-note wb-pad">and {(matches.length - LISTED).toLocaleString()} more; narrow the filters to list them</p>}
  </nav>;
}

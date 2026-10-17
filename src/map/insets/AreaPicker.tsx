import { useId, useMemo, useState } from "react";
import type { InsetArea } from "./assets";

/** One entry per name: the largest area with it (areas arrive largest first). */
function byName(areas: InsetArea[]) {
  const seen = new Set<string>();
  return areas.filter(area => !seen.has(area.name) && Boolean(seen.add(area.name)));
}

/** A search box over the named underground and instanced areas, for showing one without a route. */
export function AreaPicker({ areas, shown, onShow, onHide }: {
  areas?: InsetArea[];
  shown: InsetArea[];
  onShow(area: InsetArea): void;
  onHide(area: InsetArea): void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const names = useMemo(() => byName(areas || []), [areas]);
  const query = text.trim().toLowerCase();
  const matches = useMemo(() => query ? names.filter(area => area.name.toLowerCase().includes(query)) : names,
    [names, query]);
  const choose = (area?: InsetArea) => {
    if (!area) return;
    onShow(area); setText(""); setOpen(false); setActive(0);
  };
  return <div className="area-picker">
    <div className="area-search">
      <span aria-hidden="true">AREA</span>
      <input type="search" role="combobox" aria-expanded={open && matches.length > 0} aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined} aria-autocomplete="list"
        aria-label="Show an underground or instanced area" placeholder={areas ? "Dungeons, caves, instances…" : "Loading areas…"}
        disabled={!areas} value={text}
        onChange={event => { setText(event.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter") { event.preventDefault(); choose(matches[active]); }
          else if (event.key === "Escape") setOpen(false);
        }} />
    </div>
    {open && matches.length > 0 && <ul className="area-results" id={listId} role="listbox">
      {matches.map((area, index) => <li key={area.regionId} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        onMouseDown={event => { event.preventDefault(); choose(area); }} onMouseEnter={() => setActive(index)}>
        {area.name}{!area.entrance && <small>no known entrance</small>}
      </li>)}
    </ul>}
    {shown.length > 0 && <ul className="area-chips" aria-label="Shown areas">
      {shown.map(area => <li key={area.regionId}><span>{area.name}</span>
        <button type="button" aria-label={`Hide ${area.name}`} onClick={() => onHide(area)}>×</button></li>)}
    </ul>}
  </div>;
}

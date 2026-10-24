import { useState, type ReactNode } from "react";

/** One overlay a page offers over the inset map. */
export interface MapLayerEntry {
  id: string;
  label: string;
  /** The colour the layer draws in, beside its name. */
  swatch?: string;
  on: boolean;
  disabled?: boolean;
  /** What the layer shows, on hover. */
  title?: string;
  /** Shown under the layer while it is on: loading, an error, a note. */
  status?: ReactNode;
  /** The layer's own settings, shown while it is on. */
  options?: ReactNode;
}

const PHONE = "(max-width: 760px)";

/**
 * The map's overlays, switched on and off over the map itself; what is selected in them is the
 * page's side panel's business. Open on a desktop, folded to a button on a phone.
 */
export function LayerControl({ layers, onToggle }: { layers: MapLayerEntry[]; onToggle(id: string, on: boolean): void }) {
  const [open, setOpen] = useState(() => !window.matchMedia?.(PHONE).matches);
  const on = layers.filter(layer => layer.on).length;
  return <div className="layer-control" role="group" aria-label="Map layers">
    <button type="button" className="layer-control-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      Layers{on > 0 && <small> {on} on</small>}
    </button>
    {open && <ul>
      {layers.map(layer => <li key={layer.id} title={layer.title}>
        <label>
          <input type="checkbox" checked={layer.on} disabled={layer.disabled} onChange={event => onToggle(layer.id, event.target.checked)} />
          {layer.swatch && <i className="layer-swatch" style={{ background: layer.swatch }} />}
          {layer.label}
        </label>
        {layer.on && layer.status && <div className="layer-status">{layer.status}</div>}
        {layer.on && layer.options && <div className="layer-options">{layer.options}</div>}
      </li>)}
    </ul>}
  </div>;
}

/** A layer list from the URL (`layers=a,b`), the page's default when absent; only ids it knows. */
export function readLayers(params: URLSearchParams, known: readonly string[]): string[] | undefined {
  const value = params.get("layers");
  return value === null ? undefined : value.split(",").filter(id => known.includes(id));
}

/** Toggles one layer in a list, keeping `known`'s order. */
export const toggleLayer = (shown: readonly string[], id: string, on: boolean, known: readonly string[]) =>
  known.filter(other => other === id ? on : shown.includes(other));

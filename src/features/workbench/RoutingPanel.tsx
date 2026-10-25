import { useEffect, useMemo, useState } from "react";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import type { MapLayerEntry } from "../../map/insets/LayerControl";
import type { WorldBox } from "../../map/insets/projection";
import { RoutingData, squarePath, type RoutingComponent, type RoutingCrossing, type RoutingOptions, type RoutingOverlay,
  type RoutingPin } from "../../map/insets/routing";

/** The routing layers, as the map's layer control and the page's URL name them. */
export const ROUTING_LAYERS = ["components", "separators", "unreachable"] as const;
const LOOKS: Record<typeof ROUTING_LAYERS[number], { label: string; swatch: string; title: string }> = {
  components: { label: "Routing components", swatch: "#8ce0f4", title: "The production search graph's components, each in its own colour; click a tile for its component" },
  separators: { label: "Synthetic separators", swatch: "#e8b765", title: "The pathfinder's internal crossings between components, not transports" },
  unreachable: { label: "Structurally unreachable", swatch: "rgb(214,70,170)", title: "Walkable terrain no route can reach; seas are never shown" },
};

/**
 * The routing partition layers of the pinned production graph (`tiles.json.routingLayers`): the
 * overlay for the inset map, its entries in the map's layer control (which ones are on is the page's,
 * in `shown`), and a panel explaining the inspected tile, component or crossing. Toggling a layer
 * updates the map's existing composition.
 */
export function useRoutingLayers(inspected: WorldPoint | undefined, focus: (box: WorldBox) => void, shown: readonly string[], wanted = false) {
  const pin = tiles.routingLayers as RoutingPin | null;
  const [data, setData] = useState<RoutingData>();
  const [error, setError] = useState("");
  const [minimumSize, setMinimumSize] = useState(0);
  const [selection, setSelection] = useState<Pick<RoutingOptions, "selectedComponent" | "selectedCrossing">>({});
  // Bumped when a square arrives, so the inspected tile's text follows without relaying out the map.
  const [arrivals, setArrivals] = useState(0);
  const [component, setComponent] = useState<RoutingComponent>();
  const on = (layer: typeof ROUTING_LAYERS[number]) => !!pin && shown.includes(layer);
  const options = useMemo<RoutingOptions>(() => ({ components: on("components"), separators: on("separators"), unreachable: on("unreachable"), minimumSize, ...selection }),
    [shown.join(","), minimumSize, selection]);
  const active = options.components || options.separators || options.unreachable;

  // The release loads the first time a layer is switched on, or the page wants it for something else (`wanted`).
  useEffect(() => {
    if (!pin || !(active || wanted) || data) return;
    const abort = new AbortController();
    RoutingData.load(`${tiles.base}/routing-layers/${pin.version}`, pin, tiles.version, abort.signal).then(
      value => { if (!abort.signal.aborted) setData(value); },
      error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, [active, wanted, data]);

  useEffect(() => data?.subscribe(() => {
    setArrivals(value => value + 1);
    if (data.error) setError(data.error);
  }), [data]);

  // An inspected tile selects its production component.
  useEffect(() => {
    if (!data || !inspected || !active) return;
    let cancelled = false;
    void data.loadSquare(squarePath(inspected)).then(() => {
      if (cancelled) return;
      setSelection({ selectedComponent: data.inspect(inspected).component });
    });
    return () => { cancelled = true; };
  }, [data, inspected, active]);

  useEffect(() => {
    setComponent(undefined);
    if (!data || selection.selectedComponent === undefined) return;
    let cancelled = false;
    data.component(selection.selectedComponent).then(
      value => { if (!cancelled) setComponent(value); },
      error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [data, selection.selectedComponent]);

  const overlay = useMemo<RoutingOverlay | undefined>(() => data ? { data, options } : undefined, [data, options]);
  const inspection = useMemo(() => data && inspected && active ? data.inspect(inspected) : undefined, [data, inspected, active, arrivals]);
  const crossing = selection.selectedCrossing;
  const chooseComponent = (id: number) => setSelection({ selectedComponent: id });
  const focusComponent = (c: RoutingComponent) => focus({
    reference: { x: c.representative[0], y: c.representative[1], plane: c.plane },
    plane: c.plane, x1: c.bounds[0], y1: c.bounds[1], x2: c.bounds[2] - 1, y2: c.bounds[3] - 1,
  });

  // Loading and errors show under the first layer switched on.
  const status = error ? <span role="alert" className="wb-warning">{error}</span> : !data ? <span role="status">Loading verified routing layers…</span> : undefined;
  const first = ROUTING_LAYERS.find(layer => options[layer]);
  const layers: MapLayerEntry[] = ROUTING_LAYERS.map(id => ({
    id, ...LOOKS[id], on: options[id], disabled: !pin,
    title: pin ? LOOKS[id].title : "No compatible routing release is pinned.",
    status: id === first ? status : undefined,
    options: id === "unreachable" ? <label title="By the size of the whole natural walking component. Seas are never shown.">
      Hide under <input aria-label="Minimum unreachable fragment tiles" type="number" min="0" step="1" value={minimumSize}
        onChange={event => setMinimumSize(Math.max(0, Math.floor(Number(event.target.value) || 0)))} /> tiles
    </label> : undefined,
  }));

  const details = active && (inspection || component || crossing);
  const panel = details ? <section className="wb-panel-body wb-routing" aria-label="Routing partitions">
    <h3>Routing</h3>
    {inspection && <p aria-label="Routing tile status">
      {inspection.status}{inspection.component !== undefined && ` · production routing component ${inspection.component}`}
    </p>}
    {component && <div aria-label="Production routing component">
      <p>
        <b>Component {component.id}</b> · {component.tileCount.toLocaleString()} tiles · plane {component.plane}
        {" "}<button type="button" onClick={() => focusComponent(component)}>Focus component</button>
      </p>
      {component.neighbours.length > 0 && <p>Crosses to: {component.neighbours.map(id =>
        <button type="button" key={id} onClick={() => chooseComponent(id)}>{id}</button>)}</p>}
    </div>}
    {crossing && <div aria-label="Synthetic crossing details">
      <p>
        <b>Internal routing crossing {crossing.id}</b> · cost {crossing.cost}<br />
        <span className="wb-mono">{crossing.from.join(" ")} → {crossing.to.join(" ")}</span>
      </p>
      <p>Components: {[crossing.fromComponent, crossing.toComponent].map((id, i) => id === undefined
        ? <span key={i}>outside the search graph </span>
        : <button type="button" key={i} onClick={() => chooseComponent(id)}>{id}</button>)}</p>
    </div>}
  </section> : null;

  /** For the page footer, beside the other releases. */
  const provenance = data ? data.manifest.version.slice(0, 12) : undefined;
  const selectCrossing = (selectedCrossing: RoutingCrossing) => setSelection({ selectedCrossing });
  return { overlay, layers, panel, provenance, selectCrossing, data };
}


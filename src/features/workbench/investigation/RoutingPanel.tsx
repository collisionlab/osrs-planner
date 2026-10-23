import { useEffect, useMemo, useState } from "react";
import tiles from "../../../../tiles.json";
import type { WorldPoint } from "../../../domain/contracts";
import type { WorldBox } from "../../../map/insets/projection";
import { RoutingData, squarePath, type RoutingComponent, type RoutingCrossing, type RoutingOptions, type RoutingOverlay, type RoutingPin } from "../../../map/insets/routing";

/** One independent immutable pin; layer toggles update the existing composition. */
export function useRoutingLayers(inspected: WorldPoint | undefined, focus: (box: WorldBox) => void) {
  const pin = tiles.routingLayers as RoutingPin | null;
  const [data, setData] = useState<RoutingData>();
  const [error, setError] = useState("");
  const [options, setOptions] = useState<RoutingOptions>({ components: false, separators: false, unreachable: false, minimumSize: 0 });
  const [revision, setRevision] = useState(0);
  const [component, setComponent] = useState<RoutingComponent>();
  const active = options.components || options.separators || options.unreachable;
  useEffect(() => {
    if (!pin || !active || data) return;
    const abort = new AbortController();
    RoutingData.load(`${tiles.base}/routing-layers/${pin.version}`, pin, tiles.version, abort.signal).then(value => {
      if (!abort.signal.aborted) setData(value);
    }, error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, [active, data]);
  useEffect(() => data?.subscribe(() => { setRevision(value => value + 1); if (data.error) setError(data.error); }), [data]);
  useEffect(() => {
    if (!data || !inspected || !active) return;
    let cancelled = false;
    void data.loadSquare(squarePath(inspected)).then(() => {
      if (cancelled) return;
      const hit = data.inspect(inspected);
      setOptions(current => ({ ...current, selectedComponent: hit.component, selectedCrossing: undefined }));
    });
    return () => { cancelled = true; };
  }, [data, inspected, active]);
  useEffect(() => {
    setComponent(undefined);
    if (!data || options.selectedComponent === undefined) return;
    let cancelled = false;
    void data.component(options.selectedComponent).then(value => { if (!cancelled) setComponent(value); }, error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [data, options.selectedComponent]);
  const overlay = useMemo<RoutingOverlay | undefined>(() => data ? { data, options } : undefined, [data, options]);
  const crossing = options.selectedCrossing;
  const chooseComponent = (id: number) => setOptions(current => ({ ...current, selectedComponent: id }));
  const inspection = data && inspected && active ? data.inspect(inspected) : undefined;
  // revision triggers inspection text updates when a square arrives without changing the map layout.
  void revision;
  const panel = <section className="wb-panel-body wb-routing" aria-label="Routing partitions">
    <h3>Routing partitions</h3>
    {([ ["components", "Routing components"], ["separators", "Synthetic separators"], ["unreachable", "Structurally unreachable"] ] as const).map(([key,label]) =>
      <label key={key}><input type="checkbox" checked={options[key]} disabled={!pin} onChange={event => setOptions(current => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}
    {!pin && <p className="wb-note">No compatible routing release is pinned.</p>}
    {active && !data && !error && <p role="status">Loading verified routing layers…</p>}
    {error && <p role="alert" className="wb-warning">{error}</p>}
    {active && <p className="wb-note">Zoom in for exact tile boundaries. Gold dashed edges are internal pathfinding crossings; physical walls belong to the base map.</p>}
    {options.unreachable && <label>Hide fragments smaller than <input aria-label="Minimum unreachable fragment tiles" type="number" min="0" step="1" value={options.minimumSize}
      onChange={event => setOptions(current => ({ ...current, minimumSize: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} /> tiles
      <small> Presentation only, by natural walking-component size. Structural reachability has no account requirements.</small></label>}
    {inspection && <p aria-label="Routing tile status">{inspection.status}{inspection.component !== undefined && ` · production routing component ${inspection.component}`}</p>}
    {active && component && <div aria-label="Production routing component">
      <h4>Routing component {component.id}</h4>
      <p>{component.tileCount.toLocaleString()} search tiles · plane {component.plane}<br />Bounds: {component.bounds.join(", ")}<br />
        {component.separatorCrossings} separator crossings · {component.neighbours.length} distinct neighbours</p>
      <button type="button" onClick={() => focus({ reference: { x: component.representative[0], y: component.representative[1], plane: component.plane }, plane: component.plane, x1: component.bounds[0], y1: component.bounds[1], x2: component.bounds[2]-1, y2: component.bounds[3]-1 })}>Focus component</button>
      <p>Adjacent through crossings: {component.neighbours.map(id => <button type="button" key={id} onClick={() => chooseComponent(id)}>{id}</button>)}</p>
    </div>}
    {active && crossing && <div aria-label="Synthetic crossing details">
      <h4>Internal routing crossing {crossing.id}</h4>
      <p>{crossing.from.join(" ")} → {crossing.to.join(" ")}<br />Cost: {crossing.cost}<br />
        Components: {crossing.fromComponent ?? "outside retained search graph"} → {crossing.toComponent ?? "outside retained search graph"}</p>
      {[crossing.fromComponent,crossing.toComponent].filter((id): id is number => id !== undefined).map(id => <button type="button" key={id} onClick={() => chooseComponent(id)}>Component {id}</button>)}
      <p className="wb-note">Synthetic walking edge in the pathfinder. Version-scoped ID: {data?.manifest.version}:{crossing.id}.</p>
    </div>}
    {active && data && <p className="wb-note">Production plugin {data.manifest.plugin.revision.slice(0,12)} · routing release {data.manifest.version} · collision content verified against tiles {data.manifest.tileVersion}</p>}
  </section>;
  return { overlay, panel, selectCrossing: (selectedCrossing: RoutingCrossing) => setOptions(current => ({ ...current, selectedCrossing, selectedComponent: undefined })) };
}

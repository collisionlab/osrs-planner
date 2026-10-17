import { useEffect, useRef, useState } from "react";
import type { OsrsMapProps } from "../OsrsMap";
import { mapLayers, insetPin, type MapStyle } from "../layers";
import tiles from "../../../tiles.json";
import { loadInsetAssets, type InsetAssets } from "./assets";
import { createComposition } from "./composition";
import "ol/ol.css";
import "../routeMarkers.css";
import "./styles.css";


export function InsetMap(props: OsrsMapProps & { style: MapStyle; onFallback(): void }) {
  const target = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const composition = useRef<ReturnType<typeof createComposition> | undefined>(undefined);
  const [assets, setAssets] = useState<InsetAssets>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    if (!insetPin || insetPin.tileVersion !== tiles.version) { setError("Insets are not available for these map tiles."); return; }
    void loadInsetAssets(`${tiles.base}/insets/${insetPin.version}`, tiles.version, abort.signal)
      .then(value => { if (!abort.signal.aborted) setAssets(value); })
      .catch(error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!assets || !target.current) return;
    try {
      const layer = mapLayers[props.style] || mapLayers.standard!;
      const instance = createComposition(target.current, assets, props, () => callbacks.current, layer,
        `${tiles.base}/tactical/${tiles.version}`, setStatus);
      composition.current = instance;
      instance.select(callbacks.current.selectedSegment);
      return () => { composition.current = undefined; instance.dispose(); };
    } catch (error) { setError(String(error)); }
  }, [assets, props.route, props.start, props.destination, props.style]);
  useEffect(() => { composition.current?.select(props.selectedSegment); }, [props.selectedSegment]);
  return <>
    <div ref={target} className="route-map inset-map" tabIndex={0} aria-label="Route map with movable insets" />
    <div className="inset-actions">
      <button type="button" onClick={() => composition.current?.fit()}>Fit route</button>
      <button type="button" onClick={() => composition.current?.reset()}>Reset insets</button>
    </div>
    {(error || status || !assets) && <div className="map-message" role="status">
      {error || status || "Loading inset terrain…"}
      {error && <button type="button" onClick={props.onFallback}>Use standard map</button>}
    </div>}
  </>;
}

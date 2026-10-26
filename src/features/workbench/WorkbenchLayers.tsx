import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import tiles from "../../../tiles.json";
import type { WorldPoint } from "../../domain/contracts";
import { CollisionMap, releaseTiles } from "../../map/insets/collision";
import { COLLISION_COLOURS, COLLISION_MAX_RESOLUTION } from "../../map/insets/collisionLayer";
import type { FeatureOverlay } from "../../map/insets/features";
import { toggleLayer, type MapLayerEntry } from "../../map/insets/LayerControl";
import type { WorldBox } from "../../map/insets/projection";
import { TONES } from "../../map/insets/routeStyles";
import { bankFeatures, bankKey, bankOf, loadBanks, type Bank, type Banks } from "./banks";
import { useRoutingLayers } from "./RoutingPanel";
import { FAMILIES, loadDetail, loadMeta, loadNetworks, loadView, networkKey, sourceUrl, toneOf, toneOfType, TRANSPORTS_MAX_RESOLUTION, typeName,
  readLayerSettings, viewOverlay, WORKBENCH_LAYERS, writeLayerSettings, type LayerSettings, type TransportDetail, type TransportMeta, type TransportNetwork, type TransportSummary, type TransportView } from "./transports";

const point = (p?: WorldPoint | null) => p ? `${p.x} ${p.y} ${p.plane}` : "anywhere";
const message = (reason: unknown) => String(reason instanceof Error ? reason.message : reason);

export function TypeSwatch({ type, teleport }: { type: string; teleport: boolean }) {
  return <i className="wb-swatch" style={{ background: TONES[toneOf({ type, teleport })] }} />;
}

export function TransportDetailPanel({ detail, meta, onShow }: { detail: TransportDetail; meta?: TransportMeta; onShow(point: WorldPoint): void }) {
  const tile = (p: WorldPoint | null) => p ? <button type="button" className="wb-tile" title="Show on the map" onClick={() => onShow(p)}>{point(p)}</button> : <i>anywhere</i>;
  const needs = [...detail.requirements.map(requirement => <span key={requirement.kind + requirement.name} className={`wb-chip ${requirement.kind}`}>{requirement.name}</span>),
    ...detail.varChecks.map(check => <span key={check} className="wb-chip var">{check}</span>)];
  return <section className="wb-detail" aria-label="Transport">
    <h2><TypeSwatch type={detail.type} teleport={detail.teleport} />{detail.label || typeName(detail.type)} <small>{typeName(detail.type)}</small></h2>
    <dl className="wb-facts">
      <dt>From → to</dt><dd className="wb-mono">{tile(detail.origin)} → {tile(detail.destination)}
        {detail.remappedFrom && <span className="wb-note"> (row says {point(detail.remappedFrom)}; moved to the house landing)</span>}</dd>
      {detail.objectInfo && <><dt>Action</dt><dd>{detail.objectInfo}</dd></>}
      <dt>Takes</dt><dd>{detail.duration} ticks{detail.consumable ? " · consumable" : ""}{detail.maxWildernessLevel >= 0 ? ` · wilderness ≤ ${detail.maxWildernessLevel}` : ""}</dd>
      <dt>Needs</dt><dd>{needs.length ? needs : "nothing"}</dd>
      <dt>{detail.sources.length === 1 ? "Row" : "Rows"}</dt><dd>{detail.sources.length ? detail.sources.map(source =>
        <details key={source.role + source.line} className="wb-source">
          <summary><a href={meta ? sourceUrl(meta.plugin, source) : undefined} target="_blank" rel="noreferrer">{source.file.split("/").at(-1)}:{source.line}</a>
            {source.role !== "row" && ` (${source.role})`}{source.section && <span className="wb-note"> · {source.section}</span>}</summary>
          <div className="wb-details">{Object.entries(source.fields).filter(([, value]) => value).map(([name, value]) => <span key={name}><b>{name}</b> {value}</span>)}</div>
        </details>) : "no source row matched"}</dd>
    </dl>
  </section>;
}

export function BankDetail({ bank, onShow }: { bank: Bank; onShow(point: WorldPoint): void }) {
  return <section className="wb-detail" aria-label="Bank">
    <h2><i className="wb-swatch" style={{ background: TONES.bank }} />{bank.name || "Bank"} <small>Bank</small></h2>
    <dl className="wb-facts">
      <dt>{bank.tiles.length === 1 ? "Tile" : "Tiles"}</dt><dd className="wb-mono">{bank.tiles.map(tile =>
        <button key={point(tile)} type="button" className="wb-tile" title="Show on the map" onClick={() => onShow(tile)}>{point(tile)}</button>)}</dd>
      <dt>Needs</dt><dd>{bank.needs.length ? bank.needs.map(need => <span key={need.kind + need.name} className={`wb-chip ${need.kind}`}>{need.name}</span>) : "nothing"}</dd>
    </dl>
  </section>;
}

function NetworkDetail({ network, onShow }: { network: TransportNetwork; onShow(point: WorldPoint): void }) {
  return <section className="wb-detail" aria-label="Network">
    <h2><TypeSwatch type={network.type} teleport={false} />{network.name} <small>{network.stations.length} stations</small></h2>
    <p className="wb-mono">{network.stations.map(({ point: station, name }) => <button key={point(station)} type="button" className="wb-tile"
      title={`Show ${name || "the station"} on the map`} onClick={() => onShow(station)}>{name || point(station)}</button>)}</p>
  </section>;
}

/** Layer settings kept in the page's URL beside whatever else it keeps there (its hash is left alone). */
export function useUrlLayerSettings(): [LayerSettings, (next: LayerSettings) => void] {
  const location = useLocation(), navigate = useNavigate();
  const settings = useMemo(() => readLayerSettings(new URLSearchParams(location.search)), [location.search]);
  const update = (next: LayerSettings) => {
    const search = writeLayerSettings(new URLSearchParams(window.location.search), next).toString().replace(/%2C/g, ",");
    navigate({ search: search && `?${search}`, hash: window.location.hash }, { replace: true });
  };
  return [settings, update];
}

/** What the page has selected among the layers' own items (the explorer's), drawn whole and highlighted. */
export interface LayerSelection {
  transport?: TransportSummary;
  network?: string;
  bank?: string;
}

/**
 * The workbench's map layers, the same on every page: transports (with their types), networks,
 * banks, collision and the production routing layers. Gives the layer control's entries, the
 * overlay to draw (the page's own features over the layers'), and, for pages other than the
 * explorer, what a click on a layer's item picked and a panel describing it.
 */
export function useWorkbenchLayers({ settings, update, defaults, overlay: page, selection, inspected, focus, meta: pageMeta }: {
  settings: LayerSettings;
  update(next: LayerSettings): void;
  /** The layers on while the URL names none. */
  defaults: readonly string[];
  /** The page's own features, drawn over the layers'; its anchors lay out the map. */
  overlay?: FeatureOverlay;
  /** The explorer's selection; other pages leave it to clicks on the map (see `pick`). */
  selection?: LayerSelection;
  /** A tile clicked on the map, for the routing layers to inspect. */
  inspected?: WorldPoint;
  focus(box: WorldBox): void;
  /** The transports' metadata, when the page has loaded it already. */
  meta?: TransportMeta;
}) {
  const shown = settings.layers ?? defaults;
  const transportsOn = shown.includes("transports"), networksOn = shown.includes("networks");
  const banksOn = shown.includes("banks"), collisionOn = shown.includes("collision");
  const typesKey = settings.types?.join(",");

  // The transport types, for the filter: once a layer that shows transports is first switched on.
  const [ownMeta, setOwnMeta] = useState<TransportMeta>();
  useEffect(() => {
    if (pageMeta || ownMeta || !(transportsOn || networksOn)) return;
    const abort = new AbortController();
    loadMeta(abort.signal).then(setOwnMeta, () => {});
    return () => abort.abort();
  }, [pageMeta, ownMeta, transportsOn, networksOn]);
  const meta = pageMeta ?? ownMeta;

  // The transports in view: asked for after each move, a box per area drawn, when zoomed in far
  // enough to tell them apart.
  const [boxes, setBoxes] = useState<WorldBox[]>();
  const [zoomedOut, setZoomedOut] = useState(false);
  const [resolution, setResolution] = useState(0);
  const [view, setView] = useState<TransportView>();
  // Drawn against the boxes the view was asked for, so features never outrun the data behind them.
  const [viewBoxes, setViewBoxes] = useState<WorldBox[]>();
  const [loading, setLoading] = useState(false);
  const [viewError, setViewError] = useState("");
  useEffect(() => {
    if (!transportsOn || zoomedOut) { setView(undefined); setViewBoxes(undefined); setLoading(false); return; }
    if (!boxes) return;
    if (!boxes.length) { setView({ total: 0, transports: [] }); setViewBoxes([]); return; }
    const abort = new AbortController();
    setLoading(true);
    loadView(boxes, settings.types, abort.signal).then(loaded => { setView(loaded); setViewBoxes(boxes); setLoading(false); setViewError(""); },
      reason => { if (!abort.signal.aborted) { setViewError(message(reason)); setLoading(false); } });
    return () => abort.abort();
  }, [boxes, typesKey, transportsOn, zoomedOut]);
  const onView = (inView: WorldBox[], at: number) => {
    setBoxes(inView);
    setZoomedOut(at > TRANSPORTS_MAX_RESOLUTION);
    setResolution(at);
  };

  // Every network, drawn at any zoom: from far out they are the transports worth seeing. A hub in the
  // way can be dragged aside; where it was left lasts as long as the page.
  const [networks, setNetworks] = useState<TransportNetwork[]>();
  const [networkError, setNetworkError] = useState("");
  useEffect(() => {
    if (!networksOn || networks) return;
    const abort = new AbortController();
    loadNetworks(abort.signal).then(setNetworks, reason => { if (!abort.signal.aborted) setNetworkError(message(reason)); });
    return () => abort.abort();
  }, [networksOn, networks]);
  const [movedHubs, setMovedHubs] = useState<Record<string, WorldPoint>>({});
  const moveHub = (key: string, to: WorldPoint) => setMovedHubs(current => ({ ...current, [key]: to }));
  const placedNetworks = useMemo(() => (networks || []).map(each => {
    const hub = movedHubs[networkKey(each.id)];
    return hub ? { ...each, hub } : each;
  }), [networks, movedHubs]);

  // The banks: every one, once the layer is first switched on.
  const [banks, setBanks] = useState<Banks>();
  const [bankError, setBankError] = useState("");
  useEffect(() => {
    if (!banksOn || banks) return;
    const abort = new AbortController();
    loadBanks(abort.signal).then(setBanks, reason => { if (!abort.signal.aborted) setBankError(message(reason)); });
    return () => abort.abort();
  }, [banksOn, banks]);

  // Collision everywhere in view; the routing release also holds blocked ground's pyramid, for collision zoomed out.
  const collision = useMemo(() => new CollisionMap(releaseTiles(tiles.base, tiles.version)), []);
  const routing = useRoutingLayers(inspected, focus, shown, collisionOn);

  // An item of a layer clicked on a page other than the explorer: described under the map.
  const [picked, setPicked] = useState<{ key: string; transport?: TransportDetail; bank?: Bank; network?: TransportNetwork }>();
  const [pickError, setPickError] = useState("");
  /** The layers' items under a click: true when one was picked. */
  const pick = (keys: string[]) => {
    const bank = keys.map(key => bankOf(banks?.banks, key)).find(Boolean);
    const transport = keys.find(key => !key.includes(":") && view?.transports.some(summary => summary.id === key));
    const network = placedNetworks.find(each => keys.includes(networkKey(each.id)));
    setPickError("");
    if (transport) {
      setPicked({ key: transport });
      loadDetail(transport).then(detail => setPicked(current => current?.key === transport ? { ...current, transport: detail } : current),
        reason => setPickError(message(reason)));
    } else if (bank) setPicked({ key: bankKey(bank.id), bank });
    else if (network) setPicked({ key: networkKey(network.id), network });
    else { setPicked(undefined); return false; }
    return true;
  };
  const show = (tile: WorldPoint) => focus({ plane: tile.plane, x1: tile.x - 8, y1: tile.y - 8, x2: tile.x + 8, y2: tile.y + 8 });
  const panel = pickError ? <p className="wb-warning" role="alert">{pickError}</p>
    : picked?.transport ? <TransportDetailPanel detail={picked.transport} meta={meta} onShow={show} />
    : picked?.bank ? <BankDetail bank={picked.bank} onShow={show} />
    : picked?.network ? <NetworkDetail network={picked.network} onShow={show} />
    : picked ? <p className="wb-note" role="status">Loading…</p> : undefined;

  const overlay = useMemo<FeatureOverlay>(() => {
    const shownNetworks = networksOn ? placedNetworks.filter(each => !settings.types || settings.types.includes(each.type)) : [];
    const drawn = transportsOn || networksOn
      ? viewOverlay(view, selection?.transport, undefined, viewBoxes, selection?.network, { networks: shownNetworks, inView: boxes })
      : { features: [], anchors: [] };
    // Banks under the transports, drawn on their tiles like them, and only as close.
    const banked = banksOn && banks && boxes && !zoomedOut ? bankFeatures(banks.banks, boxes) : [];
    return {
      ...page,
      features: [...banked, ...drawn.features, ...page?.features || []],
      anchors: [...page?.anchors || [], ...drawn.anchors],
      selected: picked?.key ?? drawn.selected ?? selection?.bank ?? page?.selected,
      collision: collisionOn ? collision : undefined, collisionEverywhere: collisionOn, collisionTiles: routing.data,
      routing: routing.overlay,
    };
  }, [page, view, selection, viewBoxes, boxes, zoomedOut, banksOn, banks, transportsOn, networksOn, placedNetworks, typesKey, collisionOn, collision,
    routing.data, routing.overlay, picked?.key]);

  // The transport types, by family and one by one; they apply to the networks too.
  const shownTypes = new Set(settings.types ?? meta?.types.map(type => type.type) ?? []);
  const allTypes = meta?.types.map(type => type.type) || [];
  const setTypes = (types: string[], on: boolean) => {
    const next = on ? new Set([...shownTypes, ...types]) : new Set([...shownTypes].filter(type => !types.includes(type)));
    update({ ...settings, types: next.size === allTypes.length ? undefined : allTypes.filter(type => next.has(type)) });
  };
  const typeFilter = <>
    <div className="wb-families" role="group" aria-label="Transport families">
      {FAMILIES.map(family => {
        const types = meta?.types.filter(type => toneOfType(type) === family.tone).map(type => type.type) || [];
        const count = types.filter(type => shownTypes.has(type)).length;
        return <label key={family.tone}>
          <input type="checkbox" checked={!!types.length && count === types.length} disabled={!types.length}
            ref={input => { if (input) input.indeterminate = count > 0 && count < types.length; }}
            onChange={event => setTypes(types, event.target.checked)} />
          <i className="wb-swatch" style={{ background: TONES[family.tone] }} />{family.label}
        </label>;
      })}
    </div>
    <details className="wb-filters">
      <summary>Types {settings.types ? `(${settings.types.length} of ${meta?.types.length ?? "?"})` : "(all)"}</summary>
      <div className="wb-filter-actions">
        <button type="button" onClick={() => update({ ...settings, types: undefined })}>All</button>
        <button type="button" onClick={() => update({ ...settings, types: [] })}>None</button>
      </div>
      {meta?.types.map(type => <label key={type.type}>
        <input type="checkbox" checked={shownTypes.has(type.type)} onChange={() => setTypes([type.type], !shownTypes.has(type.type))} />
        <i className="wb-swatch" style={{ background: TONES[toneOfType(type)] }} />{typeName(type.type)} <small>{type.count}</small>
      </label>)}
    </details>
  </>;
  const moved = Object.keys(movedHubs).length;
  const layers: MapLayerEntry[] = [
    { id: "transports", label: "Transports", swatch: `linear-gradient(90deg, ${TONES.object} 33%, ${TONES.journey} 33% 66%, ${TONES.teleport} 66%)`, on: transportsOn, options: typeFilter,
      status: viewError || (zoomedOut ? "Zoom in to see transports" : undefined),
      title: "Every effective transport with an end in view, drawn on its tiles once zoomed in far enough to tell them apart" },
    { id: "networks", label: "Networks", swatch: TONES.journey, on: networksOn,
      status: networkError || (!networks ? "Loading…" : undefined),
      title: "Each network's stations joined to its hub, at any zoom; drag a hub out of the way",
      options: <p className="wb-note">Drag a hub to move it out of the way.{moved > 0 && <> <button type="button" className="wb-link" onClick={() => setMovedHubs({})}>
        Put {moved === 1 ? "the moved hub" : `${moved} moved hubs`} back</button></>}</p> },
    { id: "banks", label: "Banks", swatch: TONES.bank, on: banksOn,
      status: bankError || (zoomedOut ? "Zoom in to see banks" : !banks ? "Loading…" : undefined),
      title: "The plugin's bank tiles: filled where anyone can bank, outlined where it needs a quest, skill or unlock first" },
    { id: "collision", label: "Collision", swatch: COLLISION_COLOURS.blocked.replace(/,[.\d]+\)$/, ")"), on: collisionOn,
      status: resolution > COLLISION_MAX_RESOLUTION && !routing.data ? "Zoom in to see collision" : undefined,
      title: "The pathfinder's collision everywhere in view",
      options: <p className="wb-legend" aria-label="Collision legend">
        <span className="wb-key blocked" /> blocked <span className="wb-key wall" /> wall or door <span className="wb-key object" /> closed by an object
      </p> },
    ...routing.layers,
  ];
  const toggle = (id: string, on: boolean) => {
    const next = toggleLayer(shown, id, on, WORKBENCH_LAYERS);
    const same = next.length === defaults.length && next.every(layer => defaults.includes(layer));
    update({ ...settings, layers: same ? undefined : next });
  };

  return { layers, toggle, overlay, onView, moveHub, pick, clearPick: () => setPicked(undefined), panel, routing, collision,
    view, viewBoxes, boxes, zoomedOut, loading, networks: placedNetworks, banks, meta, transportsOn };
}

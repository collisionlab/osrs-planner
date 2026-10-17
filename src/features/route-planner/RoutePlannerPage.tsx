import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { loadCatalog } from "../../api/catalog";
import { loadPresets } from "../../api/presets";
import { calculateRoute } from "../../api/routes";
import { places } from "../../data/places";
import type { PlannerAccount } from "../../domain/accounts";
import type { Account, Location, WorldPoint } from "../../domain/contracts";
import { asSettings, validSettings, type ChangedSettings } from "../../domain/settings";
import { Itinerary } from "../itinerary/Itinerary";
import { ShareRoute } from "./ShareRoute";
import { RouteSettings } from "./RouteSettings";
import { plannerUrlWarnings, profileFromHash, readPlannerUrl, readStoredSettings, SharedProfileError, writePlannerUrl, type PlannerUrlState } from "./plannerState";

const customAccountKey = "osrs-travel.custom-account.v2";
const settingsKey = "osrs-travel.route-settings.v1";
const AccountPanel = lazy(() => import("../../components/AccountPanel").then(module => ({ default: module.AccountPanel })));
const OsrsMap = lazy(() => import("../../map/OsrsMap").then(module => ({ default: module.OsrsMap })));

async function loadCustomAccount(): Promise<Account | undefined> {
  try {
    const { validateAccount } = await import("../../domain/accountValidation");
    return validateAccount(JSON.parse(localStorage.getItem(customAccountKey) || "null"));
  } catch { return undefined; }
}

/** The shortest gap between drag previews: at most 8 a second, 80 in the edge's 10-second window. */
const DRAG_PREVIEW_MS = 120;

const insetsKey = "osrs-travel.insets.v1";

function loadStoredSettings(): ChangedSettings {
  try { return readStoredSettings(localStorage.getItem(settingsKey)); }
  catch { return {}; }
}

/** "3222, 3218" or "3222 3218 1" as a tile, else undefined. */
function parseCoordinate(text: string): WorldPoint | undefined {
  const match = /^\s*(\d{3,5})\s*[, ]\s*(\d{3,5})(?:\s*[, ]\s*(?:plane\s*)?([0-3]))?\s*$/i.exec(text);
  return match ? { x: Number(match[1]), y: Number(match[2]), plane: Number(match[3] || 0) } : undefined;
}

/** A place search in the terminal's style: named places, or a typed coordinate. */
function PlaceInput({ label, location, onSelect }: { label: string; location?: Location; onSelect(location?: Location): void }) {
  const [text, setText] = useState(location?.name || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => setText(location?.name || ""), [location]);
  const query = text.trim().toLowerCase();
  const typed = parseCoordinate(text);
  const matches: Location[] = [...typed ? [customLocation(typed)] : [],
    ...places.filter(place => !query || query === location?.name?.toLowerCase() || place.name?.toLowerCase().includes(query))];
  const choose = (place?: Location) => {
    if (!place) return;
    onSelect(place); setText(place.name || ""); setOpen(false); setActive(0);
  };
  return <div className="place-field">
    <label><span>{label}</span><input type="search" role="combobox" aria-expanded={open && matches.length > 0} aria-controls={listId}
      aria-autocomplete="list" aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
      value={text} placeholder={`Choose ${label.toLowerCase()} or type x, y`}
      onChange={event => { setText(event.target.value); setOpen(true); setActive(0); if (!event.target.value) onSelect(undefined); }}
      onFocus={event => { setOpen(true); event.target.select(); }}
      onBlur={() => { setOpen(false); setText(location?.name || ""); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (event.key === "Enter") { event.preventDefault(); choose(matches[active]); }
        else if (event.key === "Escape") setOpen(false);
      }} /></label>
    {open && matches.length > 0 && <ul className="place-results" id={listId} role="listbox" aria-label={`${label} places`}>
      {matches.map((place, index) => <li key={place.placeId || "typed"} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        onMouseDown={event => { event.preventDefault(); choose(place); }} onMouseEnter={() => setActive(index)}>
        <span>{place.placeId ? place.name : `Tile ${place.name}`}</span>
        <small>{place.coordinate.x}, {place.coordinate.y}{place.coordinate.plane ? ` · P${place.coordinate.plane}` : ""}</small>
      </li>)}
    </ul>}
  </div>;
}

function customLocation(point: WorldPoint): Location {
  return { name: `${point.x}, ${point.y}${point.plane ? `, plane ${point.plane}` : ""}`, coordinate: point };
}

export function RoutePlannerPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [customAccount, setCustomAccount] = useState<Account>();
  // The map mode a link doesn't name is the one last chosen in this browser.
  const [storedInsets, setStoredInsets] = useState(() => { try { return localStorage.getItem(insetsKey) === "1"; } catch { return false; } });
  // The account as edited in the panel, before it is saved: routes follow the edits.
  const [draftAccount, setDraftAccount] = useState<Account>();
  const [shared, setShared] = useState<{ account?: Account; error?: SharedProfileError; loading?: boolean }>({});
  const [accountPanel, setAccountPanel] = useState<"closed" | "open" | "hidden">("closed");
  const [selectedSegment, setSelectedSegment] = useState<number>();
  const [mobileItineraryOpen, setMobileItineraryOpen] = useState(false);
  const accountToggle = useRef<HTMLButtonElement>(null);
  const paramsKey = searchParams.toString();
  const storedSettings = useMemo(loadStoredSettings, []);
  const urlState = useMemo(() => readPlannerUrl(new URLSearchParams(paramsKey), storedSettings), [paramsKey, storedSettings]);

  useEffect(() => { void loadCustomAccount().then(setCustomAccount); }, []);

  useEffect(() => {
    let current = true;
    if (urlState.accountId !== "shared") { setShared({}); return () => { current = false; }; }
    setShared({ loading: true });
    void profileFromHash(location.hash).then(account => { if (current) setShared({ account }); }, error => {
      if (current) setShared({ error: error instanceof SharedProfileError ? error : new SharedProfileError("This route link contains an invalid account.") });
    });
    return () => { current = false; };
  }, [location.hash, urlState.accountId]);

  const presets = useQuery({ queryKey: ["account-presets"], queryFn: loadPresets });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: loadCatalog });
  const accounts = useMemo<PlannerAccount[]>(() => [...presets.data || [],
    ...customAccount ? [{ id: "custom", name: customAccount.name, account: customAccount }] : [],
    ...shared.account ? [{ id: "shared", name: `${shared.account.name} (shared)`, account: shared.account }] : []],
  [presets.data, customAccount, shared.account]);
  const selected = accounts.find(candidate => candidate.id === urlState.accountId)
    || (urlState.accountId !== "shared" ? presets.data?.find(candidate => candidate.id === "mid") || presets.data?.[0] : undefined);
  const settings = useMemo(() => catalog.data ? validSettings(urlState.settings, catalog.data.settings) : undefined,
    [catalog.data, urlState.settings]);
  const urlWarnings = useMemo(() => presets.data ? [...plannerUrlWarnings(new URLSearchParams(paramsKey),
    [...accounts.map(candidate => candidate.id), "shared"]),
  ...settings?.dropped.length ? [`Unknown or invalid settings were ignored: ${settings.dropped.join(", ")}.`] : []] : [],
  [accounts, paramsKey, presets.data, settings]);

  const updateUrl = (state: PlannerUrlState, options?: { replace?: boolean; hash?: string }) => {
    const search = writePlannerUrl(state).toString();
    navigate({ pathname: "/route", search: search ? `?${search}` : "", hash: options?.hash ?? location.hash },
      { replace: options?.replace });
  };
  const update = (partial: Partial<PlannerUrlState>, replace = false) => updateUrl({ ...urlState, ...partial }, { replace });
  const chooseAccount = (id: string) => updateUrl({ ...urlState, accountId: id }, { hash: id === "shared" ? location.hash : "" });

  useEffect(() => {
    if (!settings) return;
    try { localStorage.setItem(settingsKey, JSON.stringify(settings.settings)); }
    catch { /* The URL still preserves the active settings when storage is unavailable. */ }
  }, [settings]);
  useEffect(() => { setSelectedSegment(undefined); }, [urlState.start, urlState.destination, selected, settings]);

  const request = useMemo(() => selected && settings && urlState.start && urlState.destination
    ? { account: draftAccount || selected.account, settings: asSettings(settings.settings), start: urlState.start, destination: urlState.destination }
    : undefined, [selected, draftAccount, settings, urlState.start, urlState.destination]);
  const route = useQuery({
    queryKey: ["route", request],
    queryFn: ({ signal }) => calculateRoute(request!, signal), enabled: Boolean(request), retry: false,
    placeholderData: previous => previous,
  });
  useEffect(() => { if (route.data && !route.isFetching) setMobileItineraryOpen(true); }, [route.data, route.isFetching]);

  // While an endpoint is dragged on the inset map, plan provisional routes for wherever it is: one
  // request at a time, each for the latest tile once the last one answers (the service refuses
  // previews first when busy; a refused one is simply not drawn). Searches take tens of
  // milliseconds, so the route follows the pointer. They share the route cache, so releasing
  // usually shows the route at once.
  const [dragging, setDragging] = useState<{ role: "start" | "destination"; point?: WorldPoint }>();
  const [dragTarget, setDragTarget] = useState<typeof dragging>();
  const previewRequest = useMemo(() => request && dragTarget?.point
    ? { ...request, [dragTarget.role]: customLocation(dragTarget.point) } : undefined, [request, dragTarget]);
  const preview = useQuery({
    queryKey: ["route", previewRequest],
    queryFn: ({ signal }) => calculateRoute(previewRequest!, signal, "drag"), enabled: Boolean(previewRequest), retry: false,
    placeholderData: previous => previous,
  });
  // At most one preview per DRAG_PREVIEW_MS, so a long drag stays well inside the edge's rate limit.
  const lastPreview = useRef(0);
  useEffect(() => {
    if (!dragging?.point) { setDragTarget(undefined); return; }
    if (preview.isFetching) return;
    const send = () => { lastPreview.current = Date.now(); setDragTarget(dragging); };
    const wait = lastPreview.current + DRAG_PREVIEW_MS - Date.now();
    if (wait <= 0) { send(); return; }
    const timer = setTimeout(send, wait);
    return () => clearTimeout(timer);
  }, [dragging, preview.isFetching]);
  const previewRoute = dragging && previewRequest ? preview.data : undefined;

  const travelChanges = settings ? Object.keys(settings.settings).length : 0;
  const chooseStart = (start?: Location) => update({ start });
  const chooseDestination = (destination?: Location) => update({ destination });
  const closeAccountPanel = () => { setAccountPanel("hidden"); accountToggle.current?.focus(); };
  const pickMap = (coordinate: WorldPoint) => {
    if (!urlState.start || urlState.destination) update({ start: customLocation(coordinate), destination: undefined });
    else update({ destination: customLocation(coordinate) });
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/route" aria-label="Route planner home"><span className="brand-mark" aria-hidden="true">▣</span><small>GIELINOR / ROUTE TERMINAL</small></a>
      <div className="searches" aria-label="Route endpoints">
        <PlaceInput label="From" location={urlState.start} onSelect={chooseStart} /><span className="arrow" aria-hidden="true">→</span>
        <PlaceInput label="To" location={urlState.destination} onSelect={chooseDestination} />
      </div>
      <button type="button" ref={accountToggle} className="account-toggle" disabled={!selected || !catalog.data}
        aria-expanded={accountPanel === "open"} aria-controls="account-panel"
        onClick={() => accountPanel === "open" ? closeAccountPanel() : setAccountPanel("open")}>
        <span>Account</span><strong>{selected ? selected.name : "Loading…"}{draftAccount && <em className="draft-mark" title="Routes use your unsaved edits"> · edited</em>}</strong>
      </button>
    </header>

    {shared.error && <div className="link-error" role="alert"><strong>Shared account could not be opened.</strong> {shared.error.message}</div>}
    {urlWarnings.length > 0 && <div className="link-warning" role="status">{urlWarnings.map(warning => <span key={warning}>{warning}</span>)}</div>}
    <main className={accountPanel === "open" ? "workspace with-account" : "workspace"}>
      {selected && catalog.data && accountPanel !== "closed" && <Suspense fallback={<aside className="account-panel"><p className="panel-loading">Loading account…</p></aside>}>
        <AccountPanel accounts={accounts} selected={selected} catalog={catalog.data} open={accountPanel === "open"}
          onSelect={chooseAccount} onClose={closeAccountPanel} onDraft={setDraftAccount} onSave={value => {
            try { localStorage.setItem(customAccountKey, JSON.stringify(value)); }
            catch { throw new Error("This browser could not save the custom build. Check its storage permissions and try again."); }
            setCustomAccount(value); chooseAccount("custom");
          }} />
      </Suspense>}
      <section className="map" aria-label="OSRS route map">
        <div className="map-label" aria-hidden="true"><span className="live-square" /> WORLD MAP <span>GIELINOR // PLANE {urlState.start?.coordinate.plane ?? 0}</span></div>
        <Suspense fallback={<div className="map-loading" role="status">Loading map…</div>}><OsrsMap start={urlState.start}
          destination={urlState.destination} route={route.data} selectedSegment={selectedSegment}
          onSelectSegment={setSelectedSegment} onPick={pickMap} onMoveStart={point => update({ start: customLocation(point) })}
          onMoveDestination={point => update({ destination: customLocation(point) })}
          onDragEndpoint={(role, point) => setDragging(point ? { role, point } : undefined)} previewRoute={previewRoute}
          insets={urlState.insets ?? storedInsets} onInsetsChange={insets => {
            setStoredInsets(insets);
            try { localStorage.setItem(insetsKey, insets ? "1" : "0"); } catch { /* the URL still carries it */ }
            update({ insets: insets || undefined }, true);
          }} /></Suspense>
        {!urlState.start || !urlState.destination ? <p className="map-message"><span aria-hidden="true">{urlState.start ? "B" : "A"}</span>{urlState.start ? "Select destination on map" : "Select origin on map or search above"}</p> : null}
      </section>
      <Itinerary start={urlState.start} destination={urlState.destination} route={route.data} isFetching={route.isFetching}
        error={presets.isError || catalog.isError ? new Error("The planner's accounts and options could not be loaded.") : route.error}
        selectedSegment={selectedSegment}
        mobileOpen={mobileItineraryOpen} onMobileToggle={() => setMobileItineraryOpen(value => !value)}
        onSelectSegment={setSelectedSegment}
        onRetry={() => void (presets.isError ? presets.refetch() : catalog.isError ? catalog.refetch() : route.refetch())}
        controls={<>{catalog.data && settings && <details className="travel-policy">
          <summary>Travel options <span>{travelChanges ? `${travelChanges} CHANGED` : "DEFAULT"}</span></summary>
          <RouteSettings settings={catalog.data.settings} changed={settings.settings}
            onChange={changed => update({ settings: changed })} />
        </details>}
          {selected && <ShareRoute state={urlState} account={selected}
            disabled={!urlState.start || !urlState.destination || route.isFetching} />}</>} />
    </main>
    <footer className="terminal-footer">
      <span className="terminal-state"><span className="live-square" /> {route.isFetching || preview.isFetching ? "PLOTTING ROUTE" : route.isError ? "ROUTE ERROR" : route.data ? route.data.reachable ? "ROUTE READY" : "NO ROUTE FOUND" : "AWAITING COORDINATES"}</span>
      <span>ACCOUNT / {selected?.name ?? "LOADING"}</span>
      <span className="footer-coordinate">A {urlState.start ? `${urlState.start.coordinate.x}, ${urlState.start.coordinate.y}` : "—, —"} <b>→</b> B {urlState.destination ? `${urlState.destination.coordinate.x}, ${urlState.destination.coordinate.y}` : "—, —"}</span>
      <span className="footer-hint">CLICK TO PLACE / DRAG TO REFINE</span>
    </footer>
  </div>;
}

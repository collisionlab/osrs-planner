import type Map from "ol/Map";
import { unByKey } from "ol/Observable";
import type { Coordinate } from "ol/coordinate";
import type { WorldPoint } from "../../domain/contracts";

/** Optional developer interaction. The menu captures its tile before the pointer moves to Copy. */
export function inspectCoordinates(map: Map, target: HTMLElement, pick: (coordinate: Coordinate) => WorldPoint) {
  let hovered: WorldPoint | undefined;
  let captured: WorldPoint | undefined;
  let disposed = false;
  const text = (point: WorldPoint) => `${point.x} ${point.y} ${point.plane}`;
  const readout = document.createElement("div");
  readout.className = "map-coordinates";
  readout.hidden = true;
  readout.setAttribute("role", "status");
  const menu = document.createElement("div");
  menu.className = "map-coordinate-menu";
  menu.hidden = true;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Tile coordinates");
  const value = document.createElement("span"), button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy coordinates";
  menu.append(value, button);
  target.append(readout, menu);
  const close = () => { menu.hidden = true; captured = undefined; };
  const copy = async (point: WorldPoint) => {
    try {
      await navigator.clipboard.writeText(text(point));
      if (!disposed) { readout.hidden = false; readout.textContent = `${text(point)} · Copied`; }
    } catch {
      if (!disposed) { readout.hidden = false; readout.textContent = `${text(point)} · Clipboard unavailable; select the coordinates in the menu to copy`; }
    }
  };
  const pointer = map.on("pointermove", event => {
    if (event.dragging) { hovered = undefined; readout.hidden = true; return; }
    if (!menu.hidden) return;
    hovered = pick(event.coordinate);
    readout.hidden = false;
    readout.textContent = `${text(hovered)} · C to copy · Right-click for menu`;
  });
  const leave = () => { hovered = undefined; readout.hidden = true; };
  const context = (event: MouseEvent) => {
    if ((event.target as Element).closest("button, input, select, textarea, .inset-label")) return;
    event.preventDefault();
    captured = pick(map.getEventCoordinate(event));
    value.textContent = text(captured);
    menu.hidden = false;
    const pixel = map.getEventPixel(event);
    menu.style.left = `${Math.max(0, Math.min(pixel[0], target.clientWidth - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(pixel[1], target.clientHeight - menu.offsetHeight))}px`;
    button.focus({ preventScroll: true });
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !menu.hidden) { close(); target.focus({ preventScroll: true }); return; }
    if (event.key.toLowerCase() !== "c" || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const element = event.target as HTMLElement;
    if (element.isContentEditable || element.closest("input, textarea, select")) return;
    const point = captured ?? hovered;
    if (point) { event.preventDefault(); void copy(point); }
  };
  const clickCopy = () => { if (captured) void copy(captured); close(); target.focus({ preventScroll: true }); };
  const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close(); };
  const moving = map.on("movestart", () => { leave(); close(); });
  button.addEventListener("click", clickCopy);
  target.addEventListener("contextmenu", context);
  target.addEventListener("pointerleave", leave);
  document.addEventListener("keydown", key);
  document.addEventListener("pointerdown", outside);
  return () => {
    disposed = true;
    unByKey([pointer, moving]);
    button.removeEventListener("click", clickCopy);
    target.removeEventListener("contextmenu", context);
    target.removeEventListener("pointerleave", leave);
    document.removeEventListener("keydown", key);
    document.removeEventListener("pointerdown", outside);
    readout.remove(); menu.remove();
  };
}

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { WorldPoint } from "../../../domain/contracts";
import type { Revision } from "../transports";
import { tilePoint, tileText, type Triple } from "./data";

/** A tile that brings itself into view on the map. */
export function TileButton({ point, onShow, label }: { point: WorldPoint | Triple; onShow(point: WorldPoint): void; label?: string }) {
  const tile = Array.isArray(point) ? tilePoint(point) : point;
  return <button type="button" className="wb-tile wb-mono" title="Show on the map" onClick={() => onShow(tile)}>{label ?? tileText(tile)}</button>;
}

/** Where a plugin row is on GitHub: at the commit the data came from, or nowhere if that is unknown. */
export function rowUrl(plugin: Revision | undefined, file: string, line?: number) {
  if (!plugin) return undefined;
  const path = file.includes("/") ? file : `src/main/resources/transports/${file}`;
  const rev = /^[0-9a-f]{40}$/.test(plugin.rev) ? plugin.rev : "master";
  return `https://github.com/${plugin.repository}/blob/${rev}/${path}${line ? `#L${line}` : ""}`;
}

export function RowLink({ plugin, file, line }: { plugin?: Revision; file: string; line?: number }) {
  const text = `${file.split("/").at(-1)}${line ? `:${line}` : ""}`;
  const url = rowUrl(plugin, file, line);
  return url ? <a href={url} target="_blank" rel="noreferrer">{text}</a> : <span className="wb-mono">{text}</span>;
}

/** The Transport Explorer at a tile, where the transports there can be picked (its own row renderer). */
export function ExplorerLink({ point, id, children }: { point?: WorldPoint | Triple; id?: string; children?: ReactNode }) {
  const tile = point && (Array.isArray(point) ? tilePoint(point) : point);
  const search = id ? `?t=${id}` : tile ? `?at=${tile.x},${tile.y},${tile.plane}&z=10` : "";
  return <Link className="wb-explorer-link" to={`/transports${search}`} target="_blank">{children ?? "Transport explorer ↗"}</Link>;
}

export function Section({ title, note, children, label }: { title: string; note?: ReactNode; children: ReactNode; label?: string }) {
  return <section className="wb-section" aria-label={label ?? title}>
    <h3>{title}{note && <small> {note}</small>}</h3>
    {children}
  </section>;
}

/** A plain fact from a published file, or a suggestion someone still has to accept. */
export function Kind({ suggestion }: { suggestion?: boolean }) {
  return suggestion ? <span className="wb-kind suggestion" title="Suggested by the labeller's worklist; not curated">suggestion</span>
    : <span className="wb-kind fact" title="Curated in the inset release">curated</span>;
}

export async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import tiles from "../../../tiles.json";
import { insetPin } from "../../map/layers";
import type { Revision } from "./transports";

/** What the tiles release says about its collision layer (`collision/<version>/manifest.json`). */
export interface CollisionManifest { dumperSource?: Revision; cacheId?: number }

export async function loadCollisionManifest(signal?: AbortSignal): Promise<CollisionManifest | undefined> {
  const response = await fetch(`${tiles.base}/collision/${tiles.version}/manifest.json`, { signal });
  return response.ok ? response.json() : undefined;
}

export interface ProvenanceLine {
  /** What it is about: transport data, collision, insets. */
  subject: string;
  /** A few characters for the footer; `text` says it in full. */
  label: string;
  text: string;
  /** `ok`: consistent; `differs`: made from a different revision than what it is shown with; `unknown`. */
  status: "ok" | "differs" | "unknown";
}

const short = (rev?: string) => rev && /^[0-9a-f]{7,}$/.test(rev) ? rev.slice(0, 7) : "unknown";

/**
 * Where each layer of a view comes from, and whether they belong together. Collision is dumped by
 * shortest-path-tooling when a tiles release is built; transports are the plugin the service bundles
 * (through the tooling commit that pins it). Unless the tooling commits are the same, they were not
 * made together, and walls drawn under a transport may not be the plugin's.
 */
export function provenance(data: { plugin: Revision; tooling: Revision } | undefined, collision: CollisionManifest | undefined,
  dataLabel = "Transport data"): ProvenanceLine[] {
  const lines: ProvenanceLine[] = [];
  lines.push(data ? { subject: dataLabel, status: data.plugin.rev === "unknown" ? "unknown" : "ok", label: short(data.plugin.rev),
    text: `${data.plugin.repository}@${short(data.plugin.rev)} (via ${data.tooling.repository.split("/")[1]}@${short(data.tooling.rev)})` }
    : { subject: dataLabel, status: "unknown", label: "unknown", text: "unknown" });
  const dumper = collision?.dumperSource;
  if (!dumper) lines.push({ subject: "Collision", status: "unknown", label: tiles.version, text: `tiles ${tiles.version}; its source is unknown` });
  else {
    const same = !!data && data.tooling.rev === dumper.rev;
    lines.push({ subject: "Collision", status: data && data.tooling.rev !== "unknown" ? same ? "ok" : "differs" : "unknown", label: tiles.version,
      text: `tiles ${tiles.version}, dumped by ${dumper.repository.split("/")[1]}@${short(dumper.rev)} from cache ${collision?.cacheId ?? "?"}`
        + (same ? "" : data && data.tooling.rev !== "unknown" ? ` — not the commit ${dataLabel.toLowerCase()} came from, so walls may not match the plugin's` : "") });
  }
  lines.push(insetPin ? { subject: "Insets", status: insetPin.tileVersion === tiles.version ? "ok" : "differs", label: insetPin.version.slice(0, 12),
    text: `${insetPin.version.slice(0, 12)} for tiles ${insetPin.tileVersion}` } : { subject: "Insets", status: "unknown", label: "none", text: "none pinned" });
  const routing = tiles.routingLayers as { version: string; tileVersion: string } | null | undefined;
  if (routing) lines.push({ subject: "Routing layers", status: routing.tileVersion === tiles.version ? "ok" : "differs", label: routing.version.slice(0, 12),
    text: `${routing.version.slice(0, 12)} for tiles ${routing.tileVersion}`
      + (routing.tileVersion === tiles.version ? "" : " — the plugin's collision is from that release, so a few walls may differ from these tiles") });
  return lines;
}

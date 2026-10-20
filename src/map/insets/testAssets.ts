import type { Region } from "./geometry";
import type { InsetAssets } from "./assets";
export function requiredAssets(regions: Region[]): InsetAssets {
  return { base: "https://tiles/insets/i", catalogue: { regions, surfaceRects: [[0, 3000, 3000, 1000, 1000]] }, labels: {},
    manifest: { schemaVersion: 2, version: "i", layout: "explv-tms-v1", tileVersion: "v", cacheIdx255Sha256: "0".repeat(64), files: { "regions.json": "0".repeat(64), "labels.json": "0".repeat(64) } } };
}

import type { Region } from "./geometry";
import type { InsetAssets } from "./assets";
export function requiredAssets(regions: Region[]): InsetAssets {
  const planes = Array.from({ length: 4 }, () => new Set<number>());
  for (const region of regions) for (const [x, y, w, h] of region.mask) {
    for (let sx = x >> 6; sx <= (x + w - 1) >> 6; sx++) for (let sy = y >> 6; sy <= (y + h - 1) >> 6; sy++) {
      planes[region.plane].add((sx << 8) | sy);
    }
  }
  const squares = planes.map(p => [...p]);
  return { base: "https://tiles/insets/i", catalogue: { regions, surfaceRects: [[0, 3000, 3000, 1000, 1000]] }, labels: {},
    manifest: { schemaVersion: 1, version: "i", layout: "explv-tms-v1", tileVersion: "v", cacheIdx255Sha256: "0".repeat(64), files: { "regions.json": "0".repeat(64), "labels.json": "0".repeat(64) },
      planes: squares, supplemental: squares.map((s, p) => p ? s : []) } };
}

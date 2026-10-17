import type { WorldPoint } from "../../domain/contracts";
import { contains, type Region } from "./geometry";

export interface Catalogue {
  regions: Region[];
  surfaceRects: [plane: number, x: number, y: number, width: number, height: number][];
}

/** Index catalogue bounds, then require exact mask membership on the recorded floor. */
export function catalogueClassifier(catalogue: Catalogue) {
  const squares = new Map<string, Region[]>();
  for (const region of catalogue.regions) {
    const [x1, y1, x2, y2] = region.bounds;
    for (let x = Math.floor(x1 / 64); x < Math.ceil(x2 / 64); x++) {
      for (let y = Math.floor(y1 / 64); y < Math.ceil(y2 / 64); y++) {
        const key = `${region.plane}/${x}/${y}`;
        const entries = squares.get(key) || [];
        entries.push(region);
        squares.set(key, entries);
      }
    }
  }
  const surface = new Map<string, Catalogue["surfaceRects"]>();
  for (const rect of catalogue.surfaceRects) {
    const [plane, x, y, w, h] = rect;
    for (let sx = x >> 6; sx <= (x + w - 1) >> 6; sx++) for (let sy = y >> 6; sy <= (y + h - 1) >> 6; sy++) {
      const key = `${plane}/${sx}/${sy}`;
      const entries = surface.get(key) || []; entries.push(rect); surface.set(key, entries);
    }
  }
  return (point: WorldPoint): string => {
    if ((surface.get(`${point.plane}/${point.x >> 6}/${point.y >> 6}`) || []).some(([plane, x, y, width, height]) => point.plane === plane
      && point.x >= x && point.x < x + width && point.y >= y && point.y < y + height)) return "main-world";
    const candidates = squares.get(`${point.plane}/${Math.floor(point.x / 64)}/${Math.floor(point.y / 64)}`) || [];
    const region = candidates.find(region => contains(region, point.x, point.y, point.plane));
    return region?.classification === "main-world" ? "main-world" : region?.id || "unmapped";
  };
}

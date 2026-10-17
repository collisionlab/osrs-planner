import type { WorldPoint } from "../../domain/contracts";
import { contains, type Region } from "./geometry";

export interface Catalogue {
  regions: Region[];
  surfaceRects: [plane: number, x: number, y: number, width: number, height: number][];
}

/** Upper floors at most this many tiles across are shown as insets; larger ones stay where they are. */
export const MAX_UPPER_FLOOR_SPAN = 96;

/** An upper-floor surface component small enough to show as an inset beside its own footprint. */
export function isDetachedUpperFloor(region: Region) {
  const [x1, y1, x2, y2] = region.bounds;
  return region.plane > 0 && region.classification === "main-world"
    && x2 - x1 <= MAX_UPPER_FLOOR_SPAN && y2 - y1 <= MAX_UPPER_FLOOR_SPAN;
}

/**
 * Index catalogue bounds, then require exact mask membership on the recorded floor. With
 * `detachUpperFloors`, a point on a small upper surface floor (see {@link isDetachedUpperFloor})
 * belongs to that floor's own component rather than the main world, so a route that only climbs
 * (a ladder, a glider platform) shows the floor beside the ground instead of on top of it.
 */
export function catalogueClassifier(catalogue: Catalogue, { detachUpperFloors = false } = {}) {
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
    const candidates = squares.get(`${point.plane}/${Math.floor(point.x / 64)}/${Math.floor(point.y / 64)}`) || [];
    if (detachUpperFloors && point.plane > 0) {
      const floor = candidates.find(region => isDetachedUpperFloor(region) && contains(region, point.x, point.y, point.plane));
      if (floor) return floor.id;
    }
    if ((surface.get(`${point.plane}/${point.x >> 6}/${point.y >> 6}`) || []).some(([plane, x, y, width, height]) => point.plane === plane
      && point.x >= x && point.x < x + width && point.y >= y && point.y < y + height)) return "main-world";
    const region = candidates.find(region => contains(region, point.x, point.y, point.plane));
    return region?.classification === "main-world" ? "main-world" : region?.id || "unmapped";
  };
}

/**
 * The catalogue with each small upper floor the route walks on grown to cover the route's tiles on
 * that floor that no region holds. Floors are cut from visible terrain, so a walk along bare
 * branches or a gallery (the Grand Tree's first floor out to Daero) would otherwise fall back onto
 * the ground map. A run of route tiles joins the floor it starts or ends on, unless that would make
 * the floor too large to show as an inset.
 */
export function withRouteFloors(catalogue: Catalogue, route: WorldPoint[]): Catalogue {
  const classify = catalogueClassifier(catalogue, { detachUpperFloors: true });
  const floors = new Map(catalogue.regions.filter(isDetachedUpperFloor).map(region => [region.id, region]));
  const held = (point: WorldPoint) => catalogue.regions.some(region => contains(region, point.x, point.y, point.plane));
  const runs: WorldPoint[][] = [];
  route.forEach((point, index) => {
    const previous = route[index - 1];
    if (point.plane > 0 && previous?.plane === point.plane
      && Math.max(Math.abs(point.x - previous.x), Math.abs(point.y - previous.y)) <= 2) runs.at(-1)!.push(point);
    else runs.push([point]);
  });
  const grown = new Map<string, Region>();
  for (const run of runs) {
    if (run[0].plane === 0 || run.length < 2) continue;
    const floorId = run.map(classify).find(id => floors.has(id));
    if (!floorId) continue;
    const floor = grown.get(floorId) || floors.get(floorId)!;
    const added = run.filter(point => !contains(floor, point.x, point.y, point.plane) && !held(point));
    if (!added.length) continue;
    const bounds: Region["bounds"] = [...floor.bounds];
    const mask = [...floor.mask];
    const seen = new Set<string>();
    for (const { x, y } of added) {
      if (seen.has(`${x},${y}`)) continue;
      seen.add(`${x},${y}`);
      mask.push([x, y, 1, 1]);
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x + 1); bounds[3] = Math.max(bounds[3], y + 1);
    }
    const candidate = { ...floor, bounds, mask, tileCount: floor.tileCount + seen.size };
    if (isDetachedUpperFloor(candidate)) grown.set(floorId, candidate);
  }
  if (!grown.size) return catalogue;
  return { ...catalogue, regions: catalogue.regions.map(region => grown.get(region.id) || region) };
}

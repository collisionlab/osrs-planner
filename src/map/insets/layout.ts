import type { Coordinate } from "ol/coordinate";
import type { Region } from "./geometry";
import type { RouteTransition } from "./routeSections";
import { worldToMap } from "./projection";

export interface Placement {
  offset: Coordinate;
  anchored: boolean;
  parent?: string;
  segmentIndex?: number;
}

export function regionExtent(region: Region, offset: Coordinate = [0, 0]): number[] {
  const [x1, y1, x2, y2] = region.bounds;
  const a = worldToMap({ x: x1 - 0.5, y: y1 - 0.5, plane: region.plane });
  const b = worldToMap({ x: x2 - 0.5, y: y2 - 0.5, plane: region.plane });
  return [a[0] + offset[0], a[1] + offset[1], b[0] + offset[0], b[1] + offset[1]];
}

/** Place from actual route crossings, in either travel direction, then keep offsets in map units. */
export function layoutRegions(regions: Region[], transitions: RouteTransition[], surfaceRoute: Coordinate[], gap: number): Map<string, Placement> {
  const placements = new Map<string, Placement>([["main-world", { offset: [0, 0], anchored: true }]]);
  const shapes = new Map(regions.map(region => [region.id, region]));
  if (!surfaceRoute.length && regions.length && !transitions.some(t => t.fromRegion === "main-world" || t.toRegion === "main-world")) {
    // An underground-only route has a real root, without inventing a surface entrance.
    const root = transitions.find(t => shapes.has(t.fromRegion))?.fromRegion || regions[0].id;
    placements.set(root, { offset: [0, 0], anchored: true });
  }
  const obstacles: number[][] = [];
  const inside = (point: Coordinate, box: number[]) => point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
  const place = (region: Region, anchor: Coordinate, entrance: Coordinate, parentBounds?: number[]): Coordinate => {
    const bounds = regionExtent(region);
    const candidates = [1, 2, 3].flatMap(distance => [
      [Math.max(anchor[0], parentBounds?.[2] ?? anchor[0]) + gap * distance - bounds[0], anchor[1] - entrance[1]],
      [Math.min(anchor[0], parentBounds?.[0] ?? anchor[0]) - gap * distance - bounds[2], anchor[1] - entrance[1]],
      [anchor[0] - entrance[0], Math.max(anchor[1], parentBounds?.[3] ?? anchor[1]) + gap * distance - bounds[1]],
      [anchor[0] - entrance[0], Math.min(anchor[1], parentBounds?.[1] ?? anchor[1]) - gap * distance - bounds[3]],
    ]);
    const score = (offset: Coordinate) => {
      const box = regionExtent(region, offset);
      const overlaps = obstacles.filter(other => box[0] < other[2] + gap / 2 && box[2] > other[0] - gap / 2
        && box[1] < other[3] + gap / 2 && box[3] > other[1] - gap / 2).length;
      const routeHits = surfaceRoute.filter(point => inside(point, box)).length;
      return overlaps * 1e12 + routeHits * 1e9 + Math.hypot(entrance[0] + offset[0] - anchor[0], entrance[1] + offset[1] - anchor[1]);
    };
    const offset = candidates.reduce((best, next) => score(next) < score(best) ? next : best);
    obstacles.push(regionExtent(region, offset));
    return offset;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of transitions) {
      if (transition.source.kind === "teleport") continue;
      const from = placements.get(transition.fromRegion);
      const to = placements.get(transition.toRegion);
      if (!!from === !!to) continue;
      const parent = from ? transition.fromRegion : transition.toRegion;
      const child = from ? transition.toRegion : transition.fromRegion;
      const parentPoint = worldToMap(from ? transition.source.from : transition.source.to);
      const childPoint = worldToMap(from ? transition.source.to : transition.source.from);
      const parentOffset = placements.get(parent)!.offset;
      const anchor = [parentPoint[0] + parentOffset[0], parentPoint[1] + parentOffset[1]];
      const shape = shapes.get(child);
      // An unmatched approach carries the recorded route through a gap; it supplies no terrain mask.
      const parentShape = shapes.get(parent);
      const offset = shape ? place(shape, anchor, childPoint, parentShape ? regionExtent(parentShape, parentOffset) : undefined) : [anchor[0] - childPoint[0], anchor[1] - childPoint[1]];
      placements.set(child, { offset, anchored: true, parent, segmentIndex: transition.segmentIndex });
      changed = true;
    }
  }
  for (const region of regions) {
    if (placements.has(region.id)) continue;
    const rootShape = regions.find(r => placements.get(r.id)?.anchored);
    const rootExtent = rootShape ? regionExtent(rootShape, placements.get(rootShape.id)!.offset) : undefined;
    const anchor = surfaceRoute[0] || (rootExtent ? [rootExtent[2], rootExtent[3]] : [0, 0]);
    const extent = regionExtent(region);
    placements.set(region.id, { offset: place(region, anchor, [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]), anchored: false });
  }
  return placements;
}

import type { Coordinate } from "ol/coordinate";
import type { Region } from "./geometry";
import type { WorldPoint } from "../../domain/contracts";
import { worldToMap } from "./projection";

export interface Placement {
  offset: Coordinate;
  anchored: boolean;
  parent?: string;
  segmentIndex?: number;
}

/**
 * A crossing between two areas that places one beside the other: a route's transport or walk across
 * (a `RouteTransition` is one), a shown area's entrance, or an edge drawn on the map. Teleports place
 * nothing: where they land says nothing about where they leave from.
 */
export interface RegionLink {
  fromRegion: string;
  toRegion: string;
  /** The route segment that crosses, if a route does. */
  segmentIndex?: number;
  source: { kind: string; from: WorldPoint; to: WorldPoint };
}

export function regionExtent(region: Region, offset: Coordinate = [0, 0]): number[] {
  const [x1, y1, x2, y2] = region.bounds;
  const a = worldToMap({ x: x1 - 0.5, y: y1 - 0.5, plane: region.plane });
  const b = worldToMap({ x: x2 - 0.5, y: y2 - 0.5, plane: region.plane });
  return [a[0] + offset[0], a[1] + offset[1], b[0] + offset[0], b[1] + offset[1]];
}

/**
 * Place from actual route crossings, in either travel direction, then keep offsets in map units.
 * `besideFootprint` regions (upper floors) are placed beside where they really are, whatever the
 * route used to reach them: a glider landing on a platform says nothing about where it is.
 * `inPlace` regions stay at their own world coordinates.
 */
export function layoutRegions(regions: Region[], transitions: RegionLink[], surfaceRoute: Coordinate[], gap: number,
  besideFootprint: Set<string> = new Set(), inPlace: Set<string> = new Set()): Map<string, Placement> {
  const placements = new Map<string, Placement>([["main-world", { offset: [0, 0], anchored: true }]]);
  const shapes = new Map(regions.map(region => [region.id, region]));
  const obstacles: number[][] = [];
  // Regions shown where they really are: placed as they are, and others go beside them.
  for (const region of regions.filter(region => inPlace.has(region.id))) {
    placements.set(region.id, { offset: [0, 0], anchored: true });
    obstacles.push(regionExtent(region));
  }
  if (!inPlace.size && !surfaceRoute.length && regions.length && !transitions.some(t => t.fromRegion === "main-world" || t.toRegion === "main-world")) {
    // An underground-only route has a real root, without inventing a surface entrance.
    const root = transitions.find(t => shapes.has(t.fromRegion))?.fromRegion || regions[0].id;
    placements.set(root, { offset: [0, 0], anchored: true });
  }
  const inside = (point: Coordinate, box: number[]) => point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
  /** The side a placement went to: 0 right, 1 left, 2 above, 3 below. */
  const sides = new Map<string, number>();
  const place = (region: Region, anchor: Coordinate, entrance: Coordinate, parentBounds?: number[], preferredSide?: number): Coordinate => {
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
    // A preferred side outweighs distance, but never an overlap or covering the route.
    const ranked = (index: number) => score(candidates[index]) + (preferredSide !== undefined && index % 4 !== preferredSide ? 1e6 : 0);
    const best = candidates.reduce((chosen, _, index) => ranked(index) < ranked(chosen) ? index : chosen, 0);
    const offset = candidates[best];
    sides.set(region.id, best % 4);
    obstacles.push(regionExtent(region, offset));
    return offset;
  };
  // Lowest floors first: a floor above another one this route uses goes beyond it, on the same side,
  // so a building's floors read as a stack.
  const floors = regions.filter(r => besideFootprint.has(r.id)).sort((a, b) => a.plane - b.plane);
  const centre = (box: number[]) => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  floors.forEach((region, index) => {
    if (placements.has(region.id)) return; // a route that never reaches the ground stays where it is
    const footprint = regionExtent(region);
    const below = floors.slice(0, index).reverse().find(other => other.plane < region.plane
      && placements.has(other.id) && overlap(regionExtent(other), footprint));
    if (below) {
      const belowBox = regionExtent(below, placements.get(below.id)!.offset);
      const offset = place(region, centre(belowBox), centre(footprint), belowBox, sides.get(below.id));
      placements.set(region.id, { offset, anchored: true, parent: below.id });
    } else {
      placements.set(region.id, { offset: place(region, centre(footprint), centre(footprint), footprint), anchored: true, parent: "main-world" });
    }
  });
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

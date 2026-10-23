import type { RoutePlan, TravelSegment, WorldPoint } from "../../domain/contracts";
import type { ReviewOptions } from "../../map/insets/composition";
import type { CollisionMap } from "../../map/insets/collision";
import { row, type ReviewUnit, type RowChange } from "./api";

/**
 * A review unit as the inset map draws it: a route of its rows' transports, so the map lays out the
 * areas they cross exactly as it does for a planned route (an area reached only through this pull
 * request is placed beside the entrance the pull request adds), and the review marks over it.
 */
export interface UnitMap {
  route?: RoutePlan;
  review: ReviewOptions;
  /** Every tile the unit touches, to load collision around. */
  points: WorldPoint[];
}

const samePoint = (a?: WorldPoint | null, b?: WorldPoint | null) => a?.x === b?.x && a?.y === b?.y && a?.plane === b?.plane;

export function unitMap(unit: ReviewUnit, collision?: CollisionMap): UnitMap {
  const segments: TravelSegment[] = [];
  const review: ReviewOptions = { tones: {}, marks: [], collision, names: [] };
  const draw = (change: RowChange, version: "base" | "head", tone: "added" | "removed" | "changed") => {
    const shown = change[version]!;
    const { origin, destination } = shown;
    if (origin && destination) {
      review.tones[segments.length] = tone;
      segments.push({ kind: "transport", transportId: `${shown.file}:${shown.line}`, name: shown.label || unit.title,
        from: origin, to: destination, costTicks: 0, requirements: [] });
    }
    if (origin) review.marks.push({ point: origin, tone, role: "origin" });
    if (destination) review.marks.push({ point: destination, tone, role: "destination" });
  };
  for (const change of unit.changes) {
    if (change.kind === "changed" && (!samePoint(change.base!.origin, change.head!.origin)
      || !samePoint(change.base!.destination, change.head!.destination))) draw(change, "base", "removed");
    draw(change, change.head ? "head" : "base", change.kind);
  }
  const points = review.marks.map(mark => mark.point);
  // An area the inset release hasn't named takes the pull request's own heading for it.
  review.names = points.map(point => ({ point, name: `${unit.title} (from PR)` }));
  const route: RoutePlan | undefined = segments.length ? {
    apiVersion: "v1", reachable: true, costTicks: 0,
    start: { name: unit.title, coordinate: segments[0].from },
    destination: { name: unit.title, coordinate: segments.at(-1)!.to },
    segments,
    metadata: { worldDataVersion: "review", accountSchemaVersion: 1, routingEngineVersion: "astar-v1" },
  } : undefined;
  return { route, review, points };
}

/** The unit's rows as their route's segment indexes, so selecting a row highlights its edge. */
export function segmentIndex(unit: ReviewUnit, change: RowChange): number | undefined {
  let index = 0;
  for (const other of unit.changes) {
    const moved = other.kind === "changed" && (!samePoint(other.base!.origin, other.head!.origin) || !samePoint(other.base!.destination, other.head!.destination));
    const edges = (moved && other.base!.origin && other.base!.destination ? 1 : 0) + (row(other).origin && row(other).destination ? 1 : 0);
    if (other === change) return row(change).origin && row(change).destination ? index + edges - 1 : undefined;
    index += edges;
  }
  return undefined;
}

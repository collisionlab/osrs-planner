import type { BankSegment, RoutePlan, TravelSegment, WalkSegment, WorldPoint } from "../../domain/contracts";

export type RegionId = string;

export type SectionStep =
  | { segmentIndex: number; kind: "walk"; source: WalkSegment; path: WorldPoint[] }
  | { segmentIndex: number; kind: "teleport" | "transport"; source: TravelSegment }
  | { segmentIndex: number; kind: "bank"; source: BankSegment };

export interface RouteSection {
  id: number;
  regionId: RegionId;
  plane: number;
  steps: SectionStep[];
}

export interface RouteTransition {
  segmentIndex: number;
  kind: "region" | "plane";
  source: TravelSegment;
  fromRegion: RegionId;
  toRegion: RegionId;
}

export interface DecomposedRoute {
  sections: RouteSection[];
  transitions: RouteTransition[];
}

export function decomposeRoute(route: RoutePlan, classify: (point: WorldPoint) => RegionId): DecomposedRoute {
  const sections: RouteSection[] = [];
  const transitions: RouteTransition[] = [];
  let active: RouteSection | undefined;

  const section = (regionId: RegionId, plane: number) => {
    if (!active || active.regionId !== regionId || active.plane !== plane) {
      active = { id: sections.length, regionId, plane, steps: [] };
      sections.push(active);
    }
    return active;
  };

  route.segments.forEach((segment, segmentIndex) => {
    if (segment.kind === "walk") {
      let run: WorldPoint[] = [];
      let runRegion: RegionId | undefined;
      let runPlane: number | undefined;
      const flush = () => {
        if (runRegion !== undefined && runPlane !== undefined && run.length) {
          section(runRegion, runPlane).steps.push({ segmentIndex, kind: "walk", source: segment, path: run });
        }
      };
      segment.path.forEach(point => {
        const pointRegion = classify(point);
        if (run.length && (pointRegion !== runRegion || point.plane !== runPlane)) {
          flush();
          active = undefined;
          run = [];
        }
        runRegion = pointRegion;
        runPlane = point.plane;
        run.push(point);
      });
      flush();
      return;
    }

    if (segment.kind === "bank") {
      section(classify(segment.location), segment.location.plane).steps.push({ segmentIndex, kind: "bank", source: segment });
      return;
    }

    const fromRegion = classify(segment.from);
    const toRegion = classify(segment.to);
    if (fromRegion !== toRegion || segment.from.plane !== segment.to.plane) {
      transitions.push({
        segmentIndex,
        kind: fromRegion !== toRegion ? "region" : "plane",
        source: segment,
        fromRegion,
        toRegion,
      });
      active = undefined;
    } else {
      section(fromRegion, segment.from.plane).steps.push({ segmentIndex, kind: segment.kind, source: segment });
    }
  });

  return { sections, transitions };
}

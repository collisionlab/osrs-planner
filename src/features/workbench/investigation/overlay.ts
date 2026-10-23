import type { WorldPoint } from "../../../domain/contracts";
import type { InsetEntrance } from "../../../map/insets/assets";
import type { CollisionMap } from "../../../map/insets/collision";
import type { FeatureOverlay, MapFeature, OverlayRegion } from "../../../map/insets/features";
import type { WorldBox } from "../../../map/insets/projection";
import { transportFeatures, type TransportView } from "../transports";
import { evidenceOf, tilePoint, type AnchorsFile, type Area, type InvestigationData } from "./data";
import type { AreaTopology, LinkCandidate } from "./topology";

/** Item keys on the map and in the URL: what kind of thing, then its own id. */
export const key = {
  candidate: (id: string) => `cand:${id}`, suspect: (id: string) => `sus:${id}`, component: (id: string) => `comp:${id}`,
  evidence: (id: string) => `ev:${id}`, transport: (id: string) => `t:${id}`, region: (id: string) => `region:${id}`,
  anchor: (regionId: string, index: number) => `anchor:${regionId}:${index}`,
};
export const keyKind = (value?: string) => value?.slice(0, value.indexOf(":"));
export const keyId = (value: string) => value.slice(value.indexOf(":") + 1);

/** Where a region's default anchor puts it: the surface point, and where its chain arrives inside. */
export function regionEntrance(anchors: AnchorsFile, regionId: string): InsetEntrance | undefined {
  const entry = anchors.regions[regionId];
  const anchor = entry?.anchors[entry.defaultAnchor ?? 0];
  const last = anchor?.path.at(-1), connection = last && anchors.connections[last.connectionId];
  const inside = connection && (last.reversed ? connection.source : connection.target)?.point;
  return anchor && inside ? { surface: tilePoint(anchor.point), inside: tilePoint(inside), wayIn: anchor.entrance } : undefined;
}

export interface OverlayInput {
  data: InvestigationData;
  area?: Area;
  plane: number;
  mode: "topology" | "labelling";
  /** The selected region (strongly outlined). */
  region?: string;
  /** The selected item's key. */
  item?: string;
  beside: boolean;
  topology?: AreaTopology;
  /** A candidate from elsewhere in the report, when selected by link. */
  candidate?: LinkCandidate;
  transports?: { view: TransportView; boxes: WorldBox[] };
  draft?: { origin?: WorldPoint; destination?: WorldPoint };
  inspected?: WorldPoint;
  collision?: CollisionMap;
  classify(point: WorldPoint): string;
}

/** The regions the page lays out: the area's on the plane shown, and the regions its focus points are in. */
export function overlayRegions(input: Pick<OverlayInput, "data" | "area" | "plane" | "beside" | "classify">, focus: WorldPoint[]): OverlayRegion[] {
  const { data, area, plane, beside, classify } = input;
  const ids = new Set(area?.regionIds.filter(id => data.regions.get(id)?.plane === plane) || []);
  for (const point of focus) {
    const id = classify(point);
    if (data.regions.get(id)?.classification === "inset") ids.add(id);
  }
  return [...ids].sort().map(regionId => {
    const entrance = beside ? regionEntrance(data.anchors, regionId) : undefined;
    // Another plane's region shares these coordinates; in place it would cover the plane shown.
    return entrance ? { regionId, entrance } : data.regions.get(regionId)!.plane !== plane ? { regionId, aside: true } : { regionId };
  });
}

/**
 * The map for an investigation: the area's regions by their exact terrain, and what the mode is
 * about: evidence and anchors for labelling; components, candidates, suspects and transports for
 * topology; and a link being drafted. The selected candidate, the draft's ends and the inspected
 * tile are the anchors, so collision is drawn around them.
 */
export function investigationOverlay(input: OverlayInput): FeatureOverlay {
  const { data, area, plane, mode, topology } = input;
  const features: MapFeature[] = [];
  const anchors: MapFeature[] = [];
  for (const regionId of area?.regionIds || []) {
    if (data.regions.get(regionId)?.plane === plane) features.push({ kind: "mask", key: key.region(regionId), regionId, tone: "area", strong: regionId === input.region });
  }
  if (input.region && !area?.regionIds.includes(input.region)) features.push({ kind: "mask", key: key.region(input.region), regionId: input.region, tone: "component", strong: true });
  if (area && mode === "labelling") {
    for (const regionId of area.regionIds) {
      const label = data.labels[regionId];
      for (const entry of label?.areas || []) {
        if (entry.seed[2] === plane) features.push({ kind: "point", key: key.region(regionId), point: tilePoint(entry.seed), tone: "area", role: "origin" });
        for (const id of entry.evidence) {
          const record = evidenceOf(data, id);
          if (record && record.kind !== "connection") features.push({ kind: "point", key: key.evidence(id), point: tilePoint(record.point), tone: "evidence", role: "destination" });
        }
      }
      data.anchors.regions[regionId]?.anchors.forEach((anchor, index) => {
        features.push({ kind: "point", key: key.anchor(regionId, index), point: tilePoint(anchor.point), tone: "entrance", role: anchor.entrance ? "destination" : "origin" });
      });
    }
    for (const candidate of area.candidates) for (const id of candidate.evidence) {
      const record = evidenceOf(data, id);
      if (record && !record.accepted) features.push({ kind: "point", key: key.evidence(id), point: tilePoint(record.point), tone: "evidence", role: "origin" });
    }
  }
  if (mode === "topology") {
    for (const summary of input.transports?.view.transports || []) {
      features.push(...transportFeatures(summary, input.transports!.boxes).map(feature => ({ ...feature, key: key.transport(summary.id) })));
    }
    for (const { component, overlap } of topology?.components || []) {
      features.push({ kind: "region", key: key.component(component.id), plane: component.plane, bounds: component.bounds,
        tone: component.reachable ? "component" : "suspect", dashed: overlap === "bounds", label: `${component.tileCount.toLocaleString()} tiles${component.reachable ? "" : " · unreached"}` });
      for (const sample of component.samples.slice(0, 40)) features.push({ kind: "point", key: key.component(component.id), point: tilePoint(sample), tone: "component", role: "origin" });
    }
    const candidates = [...topology?.candidates || []];
    if (input.candidate && !candidates.some(candidate => candidate.id === input.candidate!.id)) candidates.push(input.candidate);
    for (const candidate of candidates) {
      const from = tilePoint(candidate.from.point), to = tilePoint(candidate.to.point), k = key.candidate(candidate.id);
      const own: MapFeature[] = [{ kind: "edge", key: k, from, to, tone: "candidate", dashed: candidate.support === "insufficient" },
        { kind: "point", key: k, point: from, tone: "candidate", role: "origin" }, { kind: "point", key: k, point: to, tone: "candidate", role: "destination" }];
      features.push(...own);
      if (input.item === k) anchors.push(...own.filter(feature => feature.kind === "point"));
    }
    for (const suspect of topology?.suspects || []) features.push({ kind: "point", key: key.suspect(suspect.id), point: tilePoint(suspect.point), tone: "suspect", role: suspect.role });
  }
  const { origin, destination } = input.draft || {};
  if (origin) anchors.push({ kind: "point", key: "draft", point: origin, tone: "draft", role: "origin" });
  if (destination) anchors.push({ kind: "point", key: "draft", point: destination, tone: "draft", role: "destination" });
  if (origin && destination) features.push({ kind: "edge", key: "draft", from: origin, to: destination, tone: "draft", dashed: true });
  if (input.inspected) anchors.push({ kind: "point", key: "tile", point: input.inspected, tone: "entrance", role: "origin" });
  // The selected candidate's regions stay laid out in either mode, so switching keeps what is shown.
  const chosen = input.candidate && input.item === key.candidate(input.candidate.id) ? [tilePoint(input.candidate.from.point), tilePoint(input.candidate.to.point)] : [];
  const focus = [...chosen, ...anchors.flatMap(feature => feature.kind === "point" ? [feature.point] : [])];
  return { features: [...features, ...anchors], anchors, selected: input.item, collision: input.collision,
    regions: overlayRegions(input, focus) };
}

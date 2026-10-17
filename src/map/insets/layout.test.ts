// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RoutePlan, WorldPoint } from "../../domain/contracts";
import type { Region } from "./geometry";
import { layoutRegions, regionExtent } from "./layout";
import { catalogueClassifier, type Catalogue } from "./preview";
import { decomposeRoute, type RouteTransition } from "./routeSections";
import catalogueFixture from "./fixtures/regions.json";
import { worldToMap } from "./projection";
import { regionTiles } from "./terrain";
import { requiredAssets } from "./testAssets";

const room = (id: string, x: number): Region => ({ id, plane: 0, bounds: [x, 10000, x + 10, 10010],
  mask: [[x, 10000, 10, 10]], classification: "inset", tileCount: 100, surfaceTiles: 0, touchesUnknown: false, examples: [] });
const point = (x: number, y = 10005): WorldPoint => ({ x, y, plane: 0 });
const crossing = (fromRegion: string, toRegion: string, from: WorldPoint, to: WorldPoint, segmentIndex: number): RouteTransition => ({
  fromRegion, toRegion, segmentIndex, kind: "region",
  source: { kind: "transport", name: "crossing", transportId: "crossing", from, to, costTicks: 1, requirements: [] },
});

describe("pasted region layout", () => {
  it("anchors a reverse-travel chain through the actual preceding region", () => {
    const transitions = [crossing("b", "a", point(205), point(105), 0),
      crossing("a", "main-world", point(102), point(3000, 3500), 1)];
    const layout = layoutRegions([room("a", 100), room("b", 200)], transitions, [worldToMap(point(3000, 3500))], 320);
    expect(layout.get("a")).toMatchObject({ anchored: true, parent: "main-world", segmentIndex: 1 });
    expect(layout.get("b")).toMatchObject({ anchored: true, parent: "a", segmentIndex: 0 });
    const a = regionExtent(room("a", 100), layout.get("a")!.offset);
    const b = regionExtent(room("b", 200), layout.get("b")!.offset);
    expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true);
  });

  it("moves the placement with the crossing used by this route", () => {
    const shape = room("a", 100);
    const place = (x: number) => layoutRegions([shape], [crossing("main-world", "a", point(x, 3500), point(105), 0)], [], 320).get("a")!.offset;
    expect(place(3100)[0] - place(3000)[0]).toBe(100 * 32);
    expect(place(3100)[1]).toBe(place(3000)[1]);
  });

  it("marks a disconnected endpoint as unanchored instead of inventing an entrance", () => {
    expect(layoutRegions([room("a", 100)], [], [worldToMap(point(3000, 3500))], 320).get("a")!.anchored).toBe(false);
  });

  it("clips native tiles at tile edges and skips empty map squares inside the bounds", () => {
    const shape: Region = { ...room("edge", 2816), bounds: [2817, 10115, 2944, 10240],
      mask: [[2817, 10115, 1, 1], [2943, 10239, 1, 1]] };
    const tiles = regionTiles(shape, requiredAssets([shape]), "https://tiles/tactical/v");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toEqual({ url: "https://tiles/tactical/v/8/29/139.png", x: -4, y: 256 });
    expect(tiles[1]).toEqual({ url: "https://tiles/tactical/v/8/30/140.png", x: 252, y: 0 });
  });

  const catalogue = catalogueFixture as Catalogue;
  const classify = catalogueClassifier(catalogue);
  const fixtures = import.meta.glob("./fixtures/routes/*.json", { eager: true, import: "default" }) as Record<string, RoutePlan>;
  it.each(Object.entries(fixtures))("lays out every required mask for %s at its native scale", (_name, plan) => {
    const points = [plan.start.coordinate, plan.destination.coordinate, ...plan.segments.flatMap(step => step.kind === "walk" ? step.path
      : step.kind === "bank" ? [step.location] : [step.from, step.to])];
    const touched = new Set(points.map(classify));
    const shapes = catalogue.regions.filter(region => touched.has(region.id));
    const transitions = decomposeRoute(plan, classify).transitions.filter(transition => transition.kind === "region");
    const placements = layoutRegions(shapes, transitions, points.filter(point => classify(point) === "main-world").map(worldToMap), 1280);
    for (const shape of shapes) {
      const placement = placements.get(shape.id)!;
      expect(placement).toBeDefined();
      const bounds = regionExtent(shape, placement.offset);
      expect(bounds.every(Number.isFinite)).toBe(true);
      expect(bounds[2] - bounds[0]).toBe((shape.bounds[2] - shape.bounds[0]) * 32);
      expect(bounds[3] - bounds[1]).toBe((shape.bounds[3] - shape.bounds[1]) * 32);
      if (plan.reachable) expect(placement.anchored).toBe(true);
      if (placement.segmentIndex !== undefined) expect(transitions.some(transition => transition.segmentIndex === placement.segmentIndex
        && [transition.fromRegion, transition.toRegion].includes(shape.id) && [transition.fromRegion, transition.toRegion].includes(placement.parent!))).toBe(true);
      expect(regionTiles(shape, requiredAssets([shape]), "https://tiles/tactical/v").every(tile => tile.url?.includes("/8/"))).toBe(true);
    }
    for (let index = 0; index < shapes.length; index++) {
      const a = regionExtent(shapes[index], placements.get(shapes[index].id)!.offset);
      for (const other of shapes.slice(index + 1)) {
        const b = regionExtent(other, placements.get(other.id)!.offset);
        expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `${shapes[index].id} overlaps ${other.id}`).toBe(true);
      }
    }
  });
});

describe("live route edge cases", () => {
  it("roots an entirely underground chain at its actual coordinates", () => {
    const transitions = [crossing("a", "b", point(105), point(205), 0)];
    const placements = layoutRegions([room("a", 100), room("b", 200)], transitions, [], 320);
    expect(placements.get("a")).toMatchObject({ offset: [0, 0], anchored: true });
    expect(placements.get("b")).toMatchObject({ parent: "a", anchored: true });
    for (const placement of placements.values()) expect(placement.offset.every(Number.isFinite)).toBe(true);
  });
  it("does not call a teleport a physical entrance", () => {
    const teleport = crossing("main-world", "a", point(3000, 3500), point(105), 0);
    teleport.source.kind = "teleport";
    const placements = layoutRegions([room("a", 100)], [teleport], [worldToMap(point(3000, 3500))], 320);
    expect(placements.get("a")!.anchored).toBe(false);
  });
});

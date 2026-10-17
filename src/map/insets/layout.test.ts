// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RoutePlan, WorldPoint } from "../../domain/contracts";
import type { Region } from "./geometry";
import { layoutRegions, regionExtent } from "./layout";
import { catalogueClassifier, withRouteFloors, type Catalogue } from "./preview";
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

describe("upper floors", () => {
  const floor = (plane: number, size = 8): Region => ({ id: `p${plane}`, plane, bounds: [2462, 3492, 2462 + size, 3492 + size],
    mask: [[2462, 3492, size, size]], classification: "main-world", tileCount: size * size, surfaceTiles: size * size,
    touchesUnknown: false, examples: [] });
  const surface: Catalogue["surfaceRects"] = [[0, 2400, 3400, 200, 200], [1, 2462, 3492, 8, 8], [2, 2462, 3492, 8, 8], [3, 2462, 3492, 8, 8]];

  it("gives a small upper floor its own region, and leaves large ones in the main world", () => {
    const catalogue: Catalogue = { surfaceRects: [...surface, [1, 3000, 3000, 200, 200]],
      regions: [floor(1), floor(2), { ...floor(1, 200), id: "big", bounds: [3000, 3000, 3200, 3200], mask: [[3000, 3000, 200, 200]] }] };
    const detached = catalogueClassifier(catalogue, { detachUpperFloors: true });
    expect(detached({ x: 2465, y: 3495, plane: 1 })).toBe("p1");
    expect(detached({ x: 2465, y: 3495, plane: 2 })).toBe("p2");
    expect(detached({ x: 2465, y: 3495, plane: 0 })).toBe("main-world");
    expect(detached({ x: 3100, y: 3100, plane: 1 })).toBe("main-world");
    expect(catalogueClassifier(catalogue)({ x: 2465, y: 3495, plane: 1 })).toBe("main-world");
  });

  it("grows a floor over the route's tiles on it that no region holds", () => {
    const catalogue: Catalogue = { surfaceRects: [...surface, [1, 2400, 3400, 200, 200]], regions: [floor(1)] };
    // Up the ladder, along a bare branch out of the room, then away by teleport.
    const branch = [2470, 2471, 2472].map(x => ({ x, y: 3494, plane: 1 }));
    const route = [{ x: 2467, y: 3494, plane: 0 }, { x: 2467, y: 3495, plane: 1 }, { x: 2469, y: 3494, plane: 1 }, ...branch,
      { x: 3222, y: 3218, plane: 0 }];
    const grown = withRouteFloors(catalogue, route);
    const classify = catalogueClassifier(grown, { detachUpperFloors: true });
    for (const tile of branch) expect(classify(tile)).toBe("p1");
    expect(grown.regions[0].bounds).toEqual([2462, 3492, 2473, 3500]);
    // A run far beyond the inset size limit stays where it is.
    const far = [{ x: 2467, y: 3495, plane: 1 }, ...Array.from({ length: 100 }, (_, i) => ({ x: 2470 + i, y: 3494, plane: 1 }))];
    expect(withRouteFloors(catalogue, far)).toBe(catalogue);
  });

  it("stacks a building's floors beside it, on one side, wherever the route arrived from", () => {
    const floors = [floor(3), floor(1), floor(2)];
    // A glider lands on the top floor from far away; that must not decide where the floor goes.
    const glider = crossing("main-world", "p3", point(3284, 3213), { x: 2465, y: 3501, plane: 3 }, 0);
    const placements = layoutRegions(floors, [glider], [worldToMap(point(2465, 3490))], 320, new Set(floors.map(f => f.id)));
    const boxes = [1, 2, 3].map(plane => regionExtent(floor(plane), placements.get(`p${plane}`)!.offset));
    const footprint = regionExtent(floor(1));
    const separate = (a: number[], b: number[]) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
    for (const box of boxes) expect(separate(box, footprint)).toBe(true);
    expect(separate(boxes[0], boxes[1]) && separate(boxes[1], boxes[2]) && separate(boxes[0], boxes[2])).toBe(true);
    // One side: the floors move away from the footprint in the same direction, each beyond the last.
    const shift = boxes.map(box => [box[0] - footprint[0], box[1] - footprint[1]]);
    const axis = Math.abs(shift[0][0]) > Math.abs(shift[0][1]) ? 0 : 1;
    expect(Math.abs(shift[1][axis])).toBeGreaterThan(Math.abs(shift[0][axis]));
    expect(Math.abs(shift[2][axis])).toBeGreaterThan(Math.abs(shift[1][axis]));
    expect(Math.sign(shift[1][axis])).toBe(Math.sign(shift[0][axis]));
    expect(placements.get("p2")).toMatchObject({ parent: "p1", anchored: true });
  });

  it("leaves a route that never reaches the ground where it is", () => {
    const placements = layoutRegions([floor(1)], [], [], 320, new Set(["p1"]));
    expect(placements.get("p1")).toMatchObject({ offset: [0, 0], anchored: true });
  });
});

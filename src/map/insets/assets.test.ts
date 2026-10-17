import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCatalogue, loadInsetAssets, loadInsetEntrances, sha256, upperFloorBuildings } from "./assets";
import { requiredAssets } from "./testAssets";
import { nativeTileUrl } from "./tactical";
import { pickWorld } from "./composition";
import { worldToMap } from "./projection";
import type { Region } from "./geometry";
const room: Region = { id: "cave", plane: 2, bounds: [2800, 10000, 2810, 10010], mask: [[2800, 10000, 10, 10]],
  classification: "inset", tileCount: 100, surfaceTiles: 0, touchesUnknown: false, examples: [] };
afterEach(() => vi.unstubAllGlobals());
describe("inset asset boundary", () => {
  it("rejects invalid masks and duplicate component identities", () => {
    const { catalogue } = requiredAssets([room]);
    expect(checkCatalogue({ ...catalogue, schemaVersion: 1 })).toEqual({ ...catalogue, schemaVersion: 1 });
    expect(() => checkCatalogue({ ...catalogue, schemaVersion: 1, regions: [room, room] })).toThrow();
    expect(() => checkCatalogue({ ...catalogue, schemaVersion: 1, regions: [{ ...room, mask: [[2800, 10000, -1, 2]] }] })).toThrow();
  });
  it("uses Explv addresses for hosted tiles and the same addresses for supplemental floors", () => {
    const assets = requiredAssets([{ ...room, plane: 0 }, room]);
    expect(nativeTileUrl(assets, "https://tiles/tactical/v", 43, 156, 0)).toBe("https://tiles/tactical/v/8/28/137.png");
    expect(nativeTileUrl(assets, "https://tiles/tactical/v", 43, 156, 2)).toBe("https://tiles/insets/i/planes/2/8/28/137.png");
    expect(nativeTileUrl(assets, "https://tiles/tactical/v", 0, 0, 2)).toBeUndefined();
  });
  it("undoes translations and restores the inset plane when picking", () => {
    const assets = requiredAssets([room]);
    const placements = new Map([[room.id, { offset: [300, -800], anchored: true }]]);
    const original = { x: 2805, y: 10004, plane: 2 };
    const display = worldToMap(original).map((v, i) => v + placements.get(room.id)!.offset[i]);
    expect(pickWorld(display, assets, placements)).toEqual(original);
    const surface = { x: 3222, y: 3218, plane: 0 };
    expect(pickWorld(worldToMap(surface), assets, placements)).toEqual(surface);
  });
  it("checks the pinned pair and content hashes before loading terrain", async () => {
    const assets = requiredAssets([room]);
    const regions = JSON.stringify({ ...assets.catalogue, schemaVersion: 1 });
    const labels = JSON.stringify({ schemaVersion: 1, catalogueSha256: await sha256(regions), regions: { cave: { name: "Cave", plane: 2 } } });
    const manifest = { ...assets.manifest, files: { "regions.json": await sha256(regions), "labels.json": await sha256(labels) } };
    const files: Record<string, string> = { "manifest.json": JSON.stringify(manifest), "regions.json": regions, "labels.json": labels };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(files[url.split("/").pop()!])));
    const signal = new AbortController().signal;
    expect((await loadInsetAssets("https://tiles/insets/i", "v", signal)).labels.cave.name).toBe("Cave");
    await expect(loadInsetAssets("https://tiles/insets/i", "wrong", signal)).rejects.toThrow("match");
    files["regions.json"] += " ";
    await expect(loadInsetAssets("https://tiles/insets/i", "v", signal)).rejects.toThrow("hash mismatch");
  });
});

describe("named areas and their entrances", () => {
  it("lists named areas with where their entrances lead, and marks each entrance once", async () => {
    const other: Region = { ...room, id: "nameless", bounds: [2900, 10000, 2905, 10005], mask: [[2900, 10000, 5, 5]] };
    const base = requiredAssets([room, other]);
    const hop = (connectionId: string, point: number[]) => ({ hops: 1, point, path: [{ connectionId, reversed: false }] });
    const anchors = JSON.stringify({
      connections: {
        ladder: { source: { point: [2884, 3397, 0], regionId: "main" }, target: { point: [2805, 10005, 2], regionId: "cave" } },
        stairs: { source: { point: [2805, 10001, 2], regionId: "cave" }, target: { point: [2950, 3300, 0], regionId: "main" } },
      },
      regions: { cave: { defaultAnchor: 1, anchors: [hop("ladder", [2884, 3397, 0]), hop("ladder", [2885, 3398, 0]),
        { hops: 1, point: [2950, 3300, 0], path: [{ connectionId: "stairs", reversed: true }] }] } },
    });
    const assets = { ...base, base: "https://tiles/insets/i",
      labels: { cave: { name: "Cave", plane: 2, status: "named" }, nameless: { name: "Unidentified", plane: 2, status: "unresolved" } },
      manifest: { ...base.manifest, files: { ...base.manifest.files, "anchors.json": await sha256(anchors) } } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(anchors)));
    const { areas, doors } = await loadInsetEntrances(assets);
    expect(areas).toEqual([{ regionId: "cave", name: "Cave", tileCount: 100,
      entrance: { surface: { x: 2885, y: 3398, plane: 0 }, inside: { x: 2805, y: 10005, plane: 2 } } }]);
    // The neighbouring ladder tile is the same entrance; the reversed stairs lead in from their target.
    expect(doors.map(door => [door.point.x, door.inside.cave])).toEqual([[2884, { x: 2805, y: 10005, plane: 2 }],
      [2950, { x: 2805, y: 10001, plane: 2 }]]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(anchors + " ")));
    await expect(loadInsetEntrances(assets)).rejects.toThrow("hash mismatch");
  });
});

it("groups overlapping upper floors into buildings, ignoring scraps", () => {
  const floor = (id: string, plane: number, x: number, size: number): Region => ({ id, plane, bounds: [x, 3200, x + size, 3200 + size],
    mask: [[x, 3200, size, size]], classification: "main-world", tileCount: size * size, surfaceTiles: size * size, touchesUnknown: false, examples: [] });
  const { floors, doors } = upperFloorBuildings({ surfaceRects: [], regions: [
    floor("castle-2", 2, 3204, 10), floor("castle-1", 1, 3200, 14), floor("ledge", 1, 3260, 3), floor("hut", 1, 3300, 6), floor("ground", 0, 3200, 20),
  ] });
  expect(doors).toEqual([
    { point: { x: 3207, y: 3207, plane: 0 }, regionIds: ["castle-1", "castle-2"], inside: {}, floors: true },
    { point: { x: 3303, y: 3203, plane: 0 }, regionIds: ["hut"], inside: {}, floors: true },
  ]);
  expect(floors.map(area => [area.regionId, area.name])).toEqual([["castle-1", "Floors at 3207, 3207"], ["castle-2", "Floors at 3207, 3207"],
    ["hut", "Floors at 3303, 3203"]]);
});

it("picks real Cam Torum geometry after automatic layout", async () => {
  const { default: rawCatalogue } = await import("./fixtures/regions.json");
  const { default: rawRoute } = await import("./fixtures/routes/cam-torum.json");
  const { catalogueClassifier } = await import("./preview");
  const { decomposeRoute } = await import("./routeSections");
  const { layoutRegions } = await import("./layout");
  const { segmentPoints } = await import("./composition");
  const route = rawRoute as unknown as import("../../domain/contracts").RoutePlan;
  const catalogue = rawCatalogue as unknown as import("./preview").Catalogue;
  const classify = catalogueClassifier(catalogue);
  const points = [route.start.coordinate, route.destination.coordinate, ...route.segments.flatMap(segmentPoints)];
  const ids = new Set(points.map(classify));
  const shapes = catalogue.regions.filter(r => ids.has(r.id));
  const placements = layoutRegions(shapes, decomposeRoute(route, classify).transitions,
    points.filter(p => classify(p) === "main-world").map(worldToMap), 320);
  const point = { x: 1459, y: 9582, plane: 1 };
  const offset = placements.get(classify(point))!.offset;
  const display = worldToMap(point).map((value, i) => value + offset[i]);
  const assets = { ...requiredAssets(shapes), catalogue };
  expect(pickWorld(display, assets, placements)).toEqual(point);
});

it("picks the underlying surface through an inset mask hole", () => {
  const holed = { ...room, mask: [[2800, 10000, 2, 10]] as Region["mask"] };
  const assets = requiredAssets([holed]);
  const placements = new Map([[holed.id, { offset: [300, -800], anchored: true }]]);
  const world = { x: 2806, y: 10005, plane: 2 };
  const display = worldToMap(world).map((value, i) => value + placements.get(holed.id)!.offset[i]);
  expect(pickWorld(display, assets, placements)).toMatchObject({ plane: 0 });
  expect(pickWorld(display, assets, placements).y).not.toBe(world.y);
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import { PastedTerrainSource } from "./PastedTerrainSource";
import { RegionFeatures } from "./RegionFeatures";
import { regionContour } from "./contour";

describe("cached inset dragging", () => {
  it("reuses the native bitmap and image wrapper through repeated pan and zoom requests", () => {
    const canvas = { width: 64, height: 64 } as HTMLCanvasElement;
    const source = new PastedTerrainSource(canvas, [0, 0, 512, 512]);
    const image = source.getImageInternal();
    for (const resolution of [1, 4, 16, 64, 128]) {
      expect(source.getImage([100, 100, 200, 200], resolution, 2, source.getProjection()!)).toBe(image);
    }
    source.moveTo([50, 30, 562, 542]);
    expect(source.getImageInternal().getImage()).toBe(canvas);
    expect(source.getImageInternal().getExtent()).toEqual([50, 30, 562, 542]);
    expect(source.getImageInternal().getResolution()).toBe(8);
  });

  it("moves only persistent features and crossing endpoints owned by the dragged region", () => {
    const index = new RegionFeatures();
    const surface = new Feature(new Point([100, 100]));
    const room = new Feature(new LineString([[10, 10], [20, 20]]));
    const cave = new Feature(new Point([30, 30]));
    const link = new LineString([[20, 20], [30, 30]]);
    index.add("main-world", surface);
    index.add("room", room);
    index.add("cave", cave);
    index.addLink("room", "cave", link);
    const surfaceRevision = surface.getRevision();
    const caveRevision = cave.getRevision();
    const geometry = room.getGeometry();
    for (let i = 0; i < 100; i++) index.translate("room", 1, -1);
    expect(room.getGeometry()).toBe(geometry);
    expect(geometry!.getCoordinates()).toEqual([[110, -90], [120, -80]]);
    expect(link.getCoordinates()).toEqual([[120, -80], [30, 30]]);
    expect(surface.getRevision()).toBe(surfaceRevision);
    expect(cave.getRevision()).toBe(caveRevision);
    index.translate("room", -100, 100);
    expect(geometry!.getCoordinates()).toEqual([[10, 10], [20, 20]]);
  });

  it("removes shared rectangle edges without losing holes in the silhouette", () => {
    expect(regionContour({ mask: [[0, 0, 2, 1], [0, 1, 2, 1]] })).toEqual([
      [[0, 0], [2, 0]], [[0, 2], [2, 2]], [[0, 0], [0, 2]], [[2, 0], [2, 2]],
    ]);
    const ring = regionContour({ mask: [[0, 0, 3, 1], [0, 2, 3, 1], [0, 1, 1, 1], [2, 1, 1, 1]] });
    expect(ring).toHaveLength(8);
    expect(ring).toContainEqual([[1, 1], [2, 1]]);
    expect(ring).toContainEqual([[1, 2], [2, 2]]);
    expect(ring).toContainEqual([[1, 1], [1, 2]]);
    expect(ring).toContainEqual([[2, 1], [2, 2]]);
  });
});

import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import type { Style } from "ol/style";
import { describe, expect, it } from "vitest";
import { endpointPixels, MIN_ENDPOINT_PX, routeFeatureStyle, routeMarkerOverlay } from "./routeStyles";

describe("production route appearance in the inset map", () => {
  it.each([
    ["walk", false, "#ffae47", 4, undefined],
    ["walk", true, "#fff2b0", 7, undefined],
    ["transport", false, "#77e2d4", 3, [6, 8]],
    ["transport", true, "#77e2d4", 6, [6, 8]],
    ["teleport", false, "#d7a6ff", 3, [6, 8]],
    ["teleport", true, "#d7a6ff", 6, [6, 8]],
  ] as const)("preserves %s styling when selected=%s", (role, selected, color, width, dash) => {
    const feature = new Feature(new LineString([[0, 0], [10, 10]]));
    feature.setProperties({ role, segmentIndex: 0 });
    const stroke = (routeFeatureStyle(feature, selected ? 0 : undefined) as Style).getStroke()!;
    expect(stroke.getColor()).toBe(color);
    expect(stroke.getWidth()).toBe(width);
    expect(stroke.getLineDash()).toEqual(dash ?? null);
    expect(stroke.getLineCap()).toBe("square");
    expect(stroke.getLineJoin()).toBe("miter");
  });

  it("keeps the endpoint marker attached through inset translation and endpoint dragging", () => {
    const feature = new Feature(new Point([100, 200]));
    const marker = routeMarkerOverlay(feature, "destination", "Destination: Dungeon");
    expect(marker.overlay.getElement()?.className).toBe("inset-endpoint destination");
    expect(marker.overlay.getElement()?.textContent).toBe("B");
    expect(marker.overlay.getPosition()).toEqual([100, 200]);
    feature.getGeometry()!.translate(50, -10);
    expect(marker.overlay.getPosition()).toEqual([150, 190]);
    feature.getGeometry()!.setCoordinates([160, 195]);
    expect(marker.overlay.getPosition()).toEqual([160, 195]);
    marker.dispose();
    feature.getGeometry()!.translate(100, 100);
    expect(marker.overlay.getPosition()).toEqual([160, 195]);
  });

  it("snaps a dragged endpoint marker to the tile under it", () => {
    const feature = new Feature(new Point([100, 200]));
    const toTile = (coordinate: number[]) => coordinate.map(value => Math.floor(value / 32) * 32 + 16);
    const marker = routeMarkerOverlay(feature, "start", "Start", toTile);
    feature.getGeometry()!.translate(30, 7);
    expect(marker.overlay.getPosition()).toEqual([144, 208]);
    marker.dispose();
  });

  it("outlines the endpoint's game tile, but keeps it visible zoomed out", () => {
    expect(endpointPixels(1)).toBe(32);
    expect(endpointPixels(2)).toBe(16);
    expect(endpointPixels(16)).toBe(MIN_ENDPOINT_PX);
  });
});

import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import { describe, expect, it } from "vitest";
import { routeFeatureStyle, routeMarkerOverlay } from "./routeStyles";

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
    const stroke = routeFeatureStyle(feature, selected ? 0 : undefined).getStroke()!;
    expect(stroke.getColor()).toBe(color);
    expect(stroke.getWidth()).toBe(width);
    expect(stroke.getLineDash()).toEqual(dash ?? null);
    expect(stroke.getLineCap()).toBe("square");
    expect(stroke.getLineJoin()).toBe("miter");
  });

  it("keeps the production target attached through inset translation and endpoint dragging", () => {
    const feature = new Feature(new Point([100, 200]));
    const marker = routeMarkerOverlay(feature, "destination", "Destination: Dungeon");
    expect(marker.overlay.getElement()?.className).toBe("route-marker destination");
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
});

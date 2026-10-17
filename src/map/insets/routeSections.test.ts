import { describe, expect, it } from "vitest";
import type { RoutePlan, TravelSegment, WorldPoint } from "../../domain/contracts";
import fixture from "./fixtures/reference.json";
import { decomposeRoute } from "./routeSections";

const route = fixture as unknown as RoutePlan;
const regionFor = (point: WorldPoint) => point.y >= 10_000 ? "keldagrim" : "main-world";

describe("route decomposition", () => {
  it("retains every segment's original movement semantics and order", () => {
    const result = decomposeRoute(route, regionFor);
    const represented = [
      ...result.sections.flatMap(section => section.steps.map(step => ({ index: step.segmentIndex, source: step.source }))),
      ...result.transitions.map(transition => ({ index: transition.segmentIndex, source: transition.source })),
    ];
    for (const [index, segment] of route.segments.entries()) {
      const copies = represented.filter(item => item.index === index);
      expect(copies.length).toBeGreaterThan(0);
      expect(copies.every(item => item.source === segment && item.source.kind === segment.kind)).toBe(true);
    }
    expect(result.sections.flatMap(section => section.steps.map(step => step.segmentIndex)))
      .toEqual([...result.sections.flatMap(section => section.steps.map(step => step.segmentIndex))].sort((a, b) => a - b));
  });

  it("keeps detached geometry out of main-world sections", () => {
    const result = decomposeRoute(route, regionFor);
    const walkPoints = result.sections.filter(section => section.regionId === "main-world")
      .flatMap(section => section.steps.filter(step => step.kind === "walk").flatMap(step => step.path));
    expect(walkPoints.length).toBeGreaterThan(500);
    expect(walkPoints.every(point => regionFor(point) === "main-world")).toBe(true);
  });

  it("records the real entry anchors without turning them into a map line", () => {
    const entry = decomposeRoute(route, regionFor).transitions.find(transition => transition.kind === "region");
    expect(entry?.source.name).toBe("Enter Tunnel 5008");
    expect(entry?.source.from).toEqual({ x: 2731, y: 3711, plane: 0 });
    expect(entry?.source.to).toEqual({ x: 2773, y: 10162, plane: 0 });
    expect(entry?.fromRegion).toBe("main-world");
    expect(entry?.toRegion).toBe("keldagrim");
  });

  it("keeps repeated visits as separate sections and records entry and exit", () => {
    const mainA: WorldPoint = { x: 3000, y: 3500, plane: 0 };
    const detachedA: WorldPoint = { x: 2800, y: 10150, plane: 0 };
    const detachedB: WorldPoint = { x: 2810, y: 10155, plane: 0 };
    const mainB: WorldPoint = { x: 3010, y: 3510, plane: 0 };
    const travel = (from: WorldPoint, to: WorldPoint, name: string): TravelSegment => ({
      kind: "transport", transportId: name, name, from, to, costTicks: 1, requirements: [],
    });
    const repeated = {
      ...route,
      segments: [
        { kind: "walk" as const, costTicks: 1, path: [mainA] as [WorldPoint] },
        travel(mainA, detachedA, "enter"),
        { kind: "walk" as const, costTicks: 1, path: [detachedA, detachedB] as [WorldPoint, WorldPoint] },
        travel(detachedB, mainB, "exit"),
        { kind: "walk" as const, costTicks: 1, path: [mainB] as [WorldPoint] },
      ],
    } satisfies RoutePlan;
    const result = decomposeRoute(repeated, regionFor);
    expect(result.sections.map(section => section.regionId)).toEqual(["main-world", "keldagrim", "main-world"]);
    expect(result.transitions.map(transition => [transition.fromRegion, transition.toRegion])).toEqual([
      ["main-world", "keldagrim"], ["keldagrim", "main-world"],
    ]);
  });

  it("does not merge plane changes into walking polylines", () => {
    const result = decomposeRoute(route, regionFor);
    expect(result.transitions.filter(transition => transition.kind === "plane")).toHaveLength(2);
    expect(result.sections.every(section => section.steps.filter(step => step.kind === "walk")
      .every(step => step.path.every(point => point.plane === section.plane)))).toBe(true);
  });
});

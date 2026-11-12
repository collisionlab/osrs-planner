import { describe, expect, it } from "vitest";
import fixture from "../../../e2e/fixtures/candidates.json";
import { filterItems, itemMeta, itemOverlay, type CandidateReport } from "./candidates";

const report = fixture as CandidateReport;
const [guild, cave, rocks] = report.items;

describe("transport candidates", () => {
  it("summarises an area by its size, contents and connectors", () => {
    expect(itemMeta(guild)).toBe("89 tiles · 1 altar · 2 connectors");
    expect(itemMeta(cave)).toBe("947 tiles · 2 connectors");
    expect(itemMeta(rocks)).toBe("38 Agility · Climb Rocks 57932");
    const dungeon = { ...cave, kind: "dungeon" as const, connectors: cave.connectors.slice(0, 1).map(c => ({ ...c, role: "entrance" as const })) };
    expect(itemMeta(dungeon)).toBe("Climb-down Ladder 60093");
    expect(itemOverlay(dungeon).features.filter(f => f.kind === "point" && f.tone === "suspect")).toHaveLength(1);
  });

  it("searches across objects, tiles and contents", () => {
    expect(filterItems(report.items, "altar")).toEqual([guild]);
    expect(filterItems(report.items, "60094")).toEqual([cave]);
    expect(filterItems(report.items, "2076 3688 0")).toEqual([cave]);
    expect(filterItems(report.items, "staircase ladder")).toEqual([]);
    expect(filterItems(report.items, "", "shortcut")).toEqual([rocks]);
    expect(filterItems(report.items, "world map link")).toEqual([cave]);
  });

  it("draws the area and an edge per connector, all anchors", () => {
    const overlay = itemOverlay(cave);
    expect(overlay.features.map(f => f.kind)).toEqual(["region", "point", "edge", "point", "point", "edge", "point"]);
    expect(overlay.anchors).toHaveLength(7);
    expect(itemOverlay(rocks).features.filter(f => f.kind === "point" && f.tone === "suspect")).toHaveLength(1);
    expect(overlay.features.every(f => f.key === cave.id)).toBe(true);
  });
});

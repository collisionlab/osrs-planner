import { describe, expect, it } from "vitest";
import fixture from "../../../e2e/fixtures/invariants.json";
import { filterFindings, findingLabel, findingOverlay, reviewNote, sourceUrl, type InvariantReport } from "./invariants";

const report = fixture as InvariantReport;
const [destination, entry, location] = report.findings;

describe("invariant findings", () => {
  it("labels transports by their action and locations by kind and name", () => {
    expect(findingLabel(destination)).toBe("Climb-up Ladder 17384");
    expect(findingLabel(location)).toBe("Bank · Fixture bank");
  });

  it("filters by invariant and by words across the row, tile and failure", () => {
    expect(filterFindings(report.findings, "entry", "")).toEqual([entry]);
    expect(filterFindings(report.findings, "", "2864 2999")).toEqual([location]);
    expect(filterFindings(report.findings, "", "shilo climb-down")).toEqual([entry]);
    expect(filterFindings(report.findings, "location", "ladder")).toEqual([]);
  });

  it("marks the tile that breaks the rule: the landing, the start, or the location", () => {
    const suspect = (f: typeof destination) => findingOverlay(f).features
      .filter(feature => feature.kind === "point" && feature.tone === "suspect").map(feature => feature.kind === "point" && feature.role);
    expect(suspect(destination)).toEqual(["destination"]);
    expect(suspect(entry)).toEqual(["origin"]);
    expect(suspect(location)).toEqual(["destination"]);
    expect(findingOverlay(location).anchors).toHaveLength(1);
    expect(findingOverlay(destination).features.some(feature => feature.kind === "edge")).toBe(true);
  });

  it("links the exact row at the checked plugin revision and drafts a review note", () => {
    expect(sourceUrl(entry, report.plugin)).toBe(`https://github.com/Skretzo/shortest-path/blob/${"1".repeat(40)}/src/main/resources/transports/transports.tsv#L1331`);
    expect(reviewNote(entry, report.plugin)).toContain("### Entry invariant entry-");
    expect(reviewNote(entry, report.plugin)).toContain("- Tile: 2862 2996 1");
  });
});

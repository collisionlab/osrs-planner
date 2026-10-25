import { describe, expect, it } from "vitest";
import fixture from "../../../e2e/fixtures/candidates.json";
import imported from "../../../service/src/main/resources/candidates/catalogue.json";
import headers from "../../../service/src/main/resources/candidates/headers.json";
import { candidateOverlay, displacement, filterUnits, groupCandidates, reviewNote, type Candidate } from "./candidates";
import { markStyle } from "../../map/insets/routeStyles";
import Feature from "ol/Feature";

const candidates = fixture.candidates as Candidate[];
const [plane, , up, down, offset] = candidates;

describe("candidate review units", () => {
  it("groups only mutually unique exact reverse pairs with compatible source", () => {
    const units = groupCandidates(candidates);
    expect(units.find(u => u.candidates.some(c => c.id === up.id))!.candidates).toEqual([up, down].sort((a, b) => a.id.localeCompare(b.id)));
    const unrelated = { ...down, id: "unrelated", source: "different evidence" };
    expect(groupCandidates([up, unrelated])).toHaveLength(2);
    expect(groupCandidates([up, down, { ...down, id: "duplicate" }])).toHaveLength(3);
    const nearby = { ...down, original: { ...down.original, origin: { ...down.original.origin!, x: down.original.origin!.x + 1 } } };
    expect(groupCandidates([up, nearby])).toHaveLength(2);
  });

  it("sorts categories deterministically and retains every row", () => {
    const units = groupCandidates(candidates);
    expect(groupCandidates([...candidates].reverse())).toEqual(units);
    expect(units[0].candidates[0].category).toBe("plane");
    expect(units.flatMap(u => u.candidates)).toHaveLength(candidates.length);
    // Decode endpoints only for this offline fixture; production uses the service's shared parser.
    const all = imported.map(c => {
      const ends = (raw: string) => {
        const names = headers[c.file as keyof typeof headers].replace(/^# /, "").split("\t"), values = raw.split("\t");
        const point = (name: string) => {
          const value = values[names.indexOf(name)];
          if (!value) return null;
          const [x, y, plane] = value.split(" ").map(Number); return { x, y, plane };
        };
        return { ...plane.original, origin: point("Origin"), destination: point("Destination") };
      };
      return { ...plane, ...c, original: ends(c.originalRaw), suggested: ends(c.suggestedRaw) } as Candidate;
    });
    const allUnits = groupCandidates(all);
    expect(allUnits).toHaveLength(167);
    expect(allUnits.filter(u => u.candidates.length === 2)).toHaveLength(79);
    expect(new Set(allUnits.flatMap(u => u.candidates.map(c => c.id))).size).toBe(246);
  });

  it("filters on member status and source, retaining both directions as a unit", () => {
    const units = groupCandidates(candidates);
    expect(filterUnits(units, "non_floor", "", "27201")[0].candidates).toHaveLength(2);
    expect(filterUnits(units, "plane", "", "Wiki")).toHaveLength(2);
    expect(filterUnits(units, "", "diverged", "")).toHaveLength(1);
    expect(filterUnits(units, "", "", "no such text")).toHaveLength(0);
  });
});

describe("candidate geometry", () => {
  it("draws old and proposed planes without inventing teleport origins", () => {
    const overlay = candidateOverlay({ id: plane.id, candidates: [plane] });
    expect(overlay.features).toHaveLength(2);
    expect(overlay.features.map(f => f.kind === "point" && [f.point.plane, f.tone, f.dashed])).toEqual([
      [0, "removed", true], [1, "added", false],
    ]);
    expect(overlay.features).toEqual(overlay.anchors);
  });

  it("keeps dashed original edges, solid proposals, selection keys and unchanged points once", () => {
    const moved = { ...offset, suggested: { ...offset.suggested, origin: offset.original.origin } };
    const overlay = candidateOverlay({ id: moved.id, candidates: [moved] }, undefined, moved.id);
    const edges = overlay.features.filter(f => f.kind === "edge");
    expect(edges.map(e => e.dashed)).toEqual([true, false]);
    expect(overlay.features.filter(f => f.kind === "point" && f.role === "origin")).toHaveLength(1);
    expect(overlay.selected).toBe(moved.id);
    expect(overlay.features.every(f => f.key === moved.id)).toBe(true);
  });

  it("distinguishes original tile outlines by dash as well as colour, including selection", () => {
    const feature = new Feature(); feature.setProperties({ tone: "removed", role: "origin", dashed: true });
    expect(markStyle(feature, 1).getStroke()?.getLineDash()).toEqual([3, 3]);
    expect(markStyle(feature, 1, true).getStroke()?.getLineDash()).toEqual([3, 3]);
    feature.set("dashed", false);
    expect(markStyle(feature, 1).getStroke()?.getLineDash()).toBeNull();
  });

  it("reports plane changes and copies the candidate identity and evidence", () => {
    expect(displacement(plane.original.destination, plane.suggested.destination)).toContain("plane 0 → 1");
    expect(reviewNote(plane)).toContain(plane.id);
    expect(reviewNote(plane)).toContain(plane.sourceCommit);
    expect(reviewNote(plane)).toContain("2862 2997 0 → 2862 2996 1");
  });
});

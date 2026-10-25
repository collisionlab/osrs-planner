import { describe, expect, it } from "vitest";
import fixture from "../../../e2e/fixtures/candidates.json";
import typesFixture from "../../../e2e/fixtures/candidate-types.json";
import imported from "../../../service/src/main/resources/candidates/catalogue.json";
import headers from "../../../service/src/main/resources/candidates/headers.json";
import { candidateOverlay, displacement, fieldComparison, filterUnits, groupCandidates, referencedGroups, reviewNote, type Candidate, type ItemGroup } from "./candidates";
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
      const ends = (raw: string | null) => {
        if (!raw) return null;
        const header = c.file ? headers[c.file as keyof typeof headers] : c.proposalHeader!;
        const names = header.replace(/^# /, "").replace("Board at", "Origin").replace("Land at", "Destination").split("\t"), values = raw.split("\t");
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
    expect(allUnits).toHaveLength(2872);
    expect(allUnits.filter(u => u.candidates.length === 2)).toHaveLength(1763);
    expect(new Set(allUnits.flatMap(u => u.candidates.map(c => c.id))).size).toBe(4635);
    expect(groupCandidates(all.slice(0, 246))).toHaveLength(167);
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
    const moved = { ...offset, suggested: { ...offset.suggested, origin: offset.original!.origin,
      destination: { ...offset.suggested!.destination!, x: offset.original!.destination!.x + 1 } } } as Candidate;
    const overlay = candidateOverlay({ id: moved.id, candidates: [moved] }, undefined, moved.id);
    const edges = overlay.features.filter(f => f.kind === "edge");
    expect(edges.map(e => e.dashed)).toEqual([true, false]);
    expect(overlay.features.filter(f => f.kind === "point" && f.role === "origin")).toHaveLength(1);
    expect(overlay.selected).toBe(moved.id);
    expect(overlay.features.every(f => f.key === moved.id)).toBe(true);
  });

  it("distinguishes original tile outlines by dash as well as colour, including selection", () => {
    const feature = new Feature(); feature.setProperties({ tone: "removed", role: "origin", dashed: true });
    expect(markStyle(feature, 1)[0].getStroke()?.getLineDash()).toEqual([3, 3]);
    expect(markStyle(feature, 1, true)[0].getStroke()?.getLineDash()).toEqual([3, 3]);
    feature.set("dashed", false);
    expect(markStyle(feature, 1)[0].getStroke()?.getLineDash()).toBeNull();
  });

  it("reports plane changes and copies the candidate identity and evidence", () => {
    expect(displacement(plane.original.destination, plane.suggested.destination)).toContain("plane 0 → 1");
    expect(reviewNote(plane)).toContain(plane.id);
    expect(reviewNote(plane)).toContain(plane.sourceCommit);
    expect(reviewNote(plane)).toContain("2862 2997 0 → 2862 2996 1");
  });
});

describe("other BestPath suggestions", () => {
  const rows = typesFixture.candidates as Candidate[];
  const find = (category: string) => rows.find(c => c.category === category)!;
  it("keeps missing requirements as field evidence with shared geometry drawn once", () => {
    const c = find("missing_requirements"), overlay = candidateOverlay({ id: c.id, candidates: [c] });
    expect(overlay.features.filter(f => f.kind === "edge")).toHaveLength(1);
    expect(overlay.features.every(f => f.tone === "changed")).toBe(true);
    expect(fieldComparison(c).find(f => f.name === "Items")?.after).toBe("[light source]=1");
    expect(referencedGroups(c, typesFixture.itemGroups as ItemGroup[]).map(g => g.name)).toEqual(["light source"]);
  });
  it("shows the original of an unrepresentable note without inventing a proposal", () => {
    const c = find("unrepresentable_requirements");
    expect(c.suggested).toBeNull();
    expect(candidateOverlay({ id: c.id, candidates: [c] }).features.every(f => f.tone === "changed")).toBe(true);
    expect(reviewNote(c)).toContain("No representable replacement supplied");
  });
  it("groups proposed reverse directions but leaves stops and notes independent", () => {
    expect(groupCandidates(rows)).toHaveLength(9);
    const pair = groupCandidates(rows).find(u => u.candidates[0].category === "sourced_transport")!;
    expect(pair.candidates).toHaveLength(2);
    expect(pair.candidates.every(c => c.original === null)).toBe(true);
  });
  it("does not invent teleport origins or network routes", () => {
    for (const category of ["network_stop", "sourced_teleport"]) {
      const c = find(category), overlay = candidateOverlay({ id: c.id, candidates: [c] });
      expect(overlay.features.filter(f => f.kind === "edge")).toHaveLength(0);
      expect(overlay.features.filter(f => f.kind === "point")).toHaveLength(1);
    }
  });
  it("searches proposal citations, network names and needs outside the format", () => {
    const units = groupCandidates(rows);
    expect(filterUnits(units, "network_stop", "", "Grimstone")).toHaveLength(1);
    expect(filterUnits(units, "", "proposed_new", "VardorvisSteps.java")).toHaveLength(1);
  });
});

describe("current destination violations", () => {
  it("keeps violations separate from proposals and copies current evidence without inventing replacements", () => {
    const violation: Candidate = { ...plane, id: "destination-example", kind: "destination_violation", category: "destination_violation",
      suggested: null, suggestedRaw: "", whatChanges: "Blocked destination with no exact transport origin.",
      sourceRepository: "Skretzo/shortest-path", sourceCommit: "a".repeat(40), upstreamCommit: "a".repeat(40),
      reconciliation: { status: "violation", rows: [] } };
    const units = groupCandidates([violation, plane]);
    expect(filterUnits(units, "destination_violation", "violation", "")).toEqual([{ id: violation.id, candidates: [violation] }]);
    const overlay = candidateOverlay({ id: violation.id, candidates: [violation] });
    expect(overlay.features).toHaveLength(1); // Teleport: destination only, no invented origin or proposal.
    expect(overlay.features[0]).toMatchObject({ tone: "suspect", role: "destination", point: plane.original!.destination });
    const note = reviewNote(violation);
    expect(note).toContain("Proposed correction: none yet");
    expect(note).toContain("https://github.com/Skretzo/shortest-path/blob/" + "a".repeat(40));
    expect(note).not.toContain("bestpath-candidates");
  });
});

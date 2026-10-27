import { describe, expect, it } from "vitest";
import { casesAt, counts, coverageFeatures, expectation, filterCases, readBenchmarkState, writeBenchmarkState, type BenchmarkCase } from "./benchmarks";

const c = (over: Partial<BenchmarkCase>): BenchmarkCase => ({ suite: "canonical", name: "route-0001/early", category: "route", profile: "early",
  tiers: ["standard"], start: [3200, 3200, 0], target: [3300, 3300, 0], allowTransports: true, expectedReachable: true, ...over });

const cases = [
  c({}),
  c({ name: "route-0001/mid", profile: "mid" }),
  c({ name: "route-0002/early", target: [3400, 3400, 0], tiers: ["full"] }),
  c({ suite: "routing-issues", name: "Digsite gate (#139)", category: "routing-issue-139", profile: "UNIT_TEST", tiers: [],
    start: [3293, 3428, 0], target: [3350, 3415, 0], description: "kudos 153+ crosses gate", minimumLength: 40 }),
];

describe("benchmark cases", () => {
  it("filters by suite, category, tier, account and text", () => {
    expect(filterCases(cases, { suite: "canonical" })).toHaveLength(3);
    expect(filterCases(cases, { categories: ["routing-issue-139"] }).map(x => x.name)).toEqual(["Digsite gate (#139)"]);
    expect(filterCases(cases, { tier: "full" }).map(x => x.name)).toEqual(["route-0002/early"]);
    expect(filterCases(cases, { profile: "mid" }).map(x => x.name)).toEqual(["route-0001/mid"]);
    expect(filterCases(cases, { query: "KUDOS" })).toHaveLength(1);
  });

  it("counts values, most first", () => {
    expect(counts(cases, x => [x.profile])).toEqual([["early", 2], ["mid", 1], ["UNIT_TEST", 1]]);
  });

  it("keeps the view in the URL and reads it back", () => {
    const state = { suite: "canonical", categories: ["route"], tier: "standard", query: "abc",
      selected: { suite: "routing-issues", name: "Digsite gate (#139)" }, layers: ["starts", "lines"] };
    expect(readBenchmarkState(writeBenchmarkState(state))).toEqual({ ...state, profile: undefined });
    expect(writeBenchmarkState({})).toBe("");
  });

  it("marks each start and target tile once, and finds the cases behind a mark", () => {
    const features = coverageFeatures(cases, ["starts", "targets"]);
    // Two shared starts collapse to one; three targets are distinct tiles but two share 3300,3300
    expect(features.filter(f => f.kind === "point" && f.tone === "start")).toHaveLength(2);
    expect(features.filter(f => f.kind === "point" && f.tone === "target")).toHaveLength(3);
    const start = features.find(f => f.kind === "point" && f.tone === "start")!;
    expect(casesAt(cases, start.key)).toHaveLength(3);
    const lines = coverageFeatures(cases, ["lines"]);
    expect(lines.every(f => f.kind === "edge")).toBe(true);
    expect(lines).toHaveLength(3);
    expect(casesAt(cases, lines[0].key)).toHaveLength(2);
  });

  it("says what a case expects", () => {
    expect(expectation(cases[3])).toBe("reachable, at least 40 steps");
    expect(expectation(c({ expectedReachable: false }))).toBe("unreachable");
  });
});

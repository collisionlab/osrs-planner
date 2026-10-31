import type { WorldPoint } from "../../domain/contracts";
import type { RoutePlan } from "../../domain/contracts";
import type { MapFeature } from "../../map/insets/features";
import type { Revision } from "./transports";

/**
 * The benchmark cases of the bundled shortest-path-tooling, from the planner service
 * (`shortestpath.workbench.Benchmarks`): every scenario of every suite, and a run of one, planned on
 * demand by tooling's own runner on the service's A* engine.
 */

type Point = [number, number, number];

export interface BenchmarkCase {
  suite: string;
  name: string;
  category: string;
  profile: string;
  tiers: string[];
  description?: string;
  start: Point;
  target: Point;
  allowTransports: boolean;
  expectedReachable: boolean;
  minimumLength?: number;
  expectedLength?: number;
}

export interface BenchmarkIndex {
  plugin: Revision;
  tooling: Revision;
  backend: string;
  suites: { name: string; scenarios: number }[];
  scenarios: BenchmarkCase[];
}

export interface BenchmarkRun {
  suite: string;
  name: string;
  backend: string;
  reached: boolean;
  termination: string | null;
  cost: number | null;
  pathLength: number;
  /** The scenario's own check: `passed` is null when it asserts nothing beyond reaching its target. */
  check: { passed: boolean | null; message: string | null };
  totalMs: number;
  phasesMs?: Record<string, number>;
  statesPopped?: number | null;
  /** Each step: x, y, plane, bank layer (0 carried, 1 banked). */
  path: [number, number, number, number][];
  transports: { step: number; type: string; info?: string; object?: string; duration: number }[];
  plan: RoutePlan;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/workbench/v1/benchmarks${path}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    throw new Error(body?.error?.message || `benchmarks: HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const loadBenchmarks = (signal?: AbortSignal) => get<BenchmarkIndex>("", signal);
export const runBenchmark = (suite: string, name: string, signal?: AbortSignal) =>
  get<BenchmarkRun>(`/run?suite=${encodeURIComponent(suite)}&name=${encodeURIComponent(name)}`, signal);

export const worldPoint = ([x, y, plane]: Point): WorldPoint => ({ x, y, plane });
export const caseKey = (c: { suite: string; name: string }) => `${c.suite}\n${c.name}`;

/** What the page shows: the filters, the selected case and the coverage layers, all kept in the URL. */
export interface BenchmarkState {
  suite?: string;
  /** Categories shown; undefined for all of the suite's. */
  categories?: string[];
  tier?: string;
  profile?: string;
  query?: string;
  /** The selected case, by suite and name. */
  selected?: { suite: string; name: string };
  /** Coverage layers on; undefined for the defaults. */
  layers?: string[];
}

export const COVERAGE_LAYERS = ["starts", "targets", "lines"] as const;
export const DEFAULT_COVERAGE = ["starts", "targets"];

export function readBenchmarkState(search: string): BenchmarkState {
  const params = new URLSearchParams(search);
  const list = (name: string) => params.has(name) ? params.get(name)!.split(",").filter(Boolean) : undefined;
  const suite = params.get("suite") || undefined, name = params.get("case") || undefined;
  return {
    suite,
    categories: list("categories"),
    tier: params.get("tier") || undefined,
    profile: params.get("profile") || undefined,
    query: params.get("q") || undefined,
    selected: name ? { suite: params.get("caseSuite") || suite || "", name } : undefined,
    layers: list("coverage"),
  };
}

export function writeBenchmarkState(state: BenchmarkState): string {
  const params = new URLSearchParams();
  if (state.suite) params.set("suite", state.suite);
  if (state.categories) params.set("categories", state.categories.join(","));
  if (state.tier) params.set("tier", state.tier);
  if (state.profile) params.set("profile", state.profile);
  if (state.query) params.set("q", state.query);
  if (state.selected) {
    params.set("case", state.selected.name);
    if (state.selected.suite !== state.suite) params.set("caseSuite", state.selected.suite);
  }
  if (state.layers) params.set("coverage", state.layers.join(","));
  const search = params.toString().replace(/%2C/g, ",");
  return search && `?${search}`;
}

/** The cases the filters keep, in the index's order. */
export function filterCases(cases: BenchmarkCase[], state: BenchmarkState): BenchmarkCase[] {
  const needle = state.query?.trim().toLowerCase();
  const categories = state.categories && new Set(state.categories);
  return cases.filter(c => (!state.suite || c.suite === state.suite)
    && (!categories || categories.has(c.category))
    && (!state.tier || c.tiers.includes(state.tier))
    && (!state.profile || c.profile === state.profile)
    && (!needle || c.name.toLowerCase().includes(needle) || c.category.toLowerCase().includes(needle)
      || !!c.description?.toLowerCase().includes(needle)));
}

/** How many of `cases` each value of `of` has, most first. */
export function counts(cases: BenchmarkCase[], of: (c: BenchmarkCase) => string[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const c of cases) for (const value of of(c)) tally.set(value, (tally.get(value) || 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const tileKey = ([x, y, plane]: Point) => `${x},${y},${plane}`;

/**
 * The cases' coverage: a mark on every start tile and every target tile, once however many cases share it
 * (each canonical route runs with four accounts), and optionally a line from each start to its target.
 * A mark's key is `coverage:<role>:<tile>`; {@link casesAt} lists the cases behind it.
 */
export function coverageFeatures(cases: BenchmarkCase[], layers: string[]): MapFeature[] {
  const features: MapFeature[] = [];
  const marks = new Map<string, { role: "start" | "target"; point: Point; names: string[] }>();
  const lines = new Set<string>();
  for (const c of cases) {
    for (const role of ["start", "target"] as const) {
      if (!layers.includes(`${role}s`)) continue;
      const key = `coverage:${role}:${tileKey(c[role])}`;
      const mark = marks.get(key) || { role, point: c[role], names: [] };
      mark.names.push(c.name);
      marks.set(key, mark);
    }
    if (layers.includes("lines")) {
      const key = `coverage:line:${tileKey(c.start)}:${tileKey(c.target)}`;
      if (!lines.has(key) && tileKey(c.start) !== tileKey(c.target)) {
        lines.add(key);
        features.push({ kind: "edge", key, from: worldPoint(c.start), to: worldPoint(c.target), tone: "coverage", spoke: true,
          title: `${c.description || c.name}` });
      }
    }
  }
  for (const [key, mark] of marks) {
    const shown = mark.names.slice(0, 3).join(", ") + (mark.names.length > 3 ? ` and ${mark.names.length - 3} more` : "");
    features.push({ kind: "point", key, point: worldPoint(mark.point), tone: mark.role, role: mark.role === "start" ? "origin" : "destination",
      title: `${mark.names.length} ${mark.role === "start" ? "starting" : "ending"} here: ${shown}` });
  }
  return features;
}

/** The cases a coverage mark or line stands for. */
export function casesAt(cases: BenchmarkCase[], key: string): BenchmarkCase[] {
  const [, role, ...rest] = key.split(":");
  if (role === "start" || role === "target") return cases.filter(c => tileKey(c[role]) === rest[0]);
  if (role === "line") return cases.filter(c => tileKey(c.start) === rest[0] && tileKey(c.target) === rest[1]);
  return [];
}

/** The case's expectation in words. */
export function expectation(c: BenchmarkCase): string {
  if (!c.expectedReachable) return "unreachable";
  if (c.expectedLength !== undefined) return `reachable, ${c.expectedLength} steps`;
  if (c.minimumLength !== undefined) return `reachable, at least ${c.minimumLength} steps`;
  return "reachable";
}

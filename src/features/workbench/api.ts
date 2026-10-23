import type { WorldPoint } from "../../domain/contracts";

/**
 * Transport reviews from the planner service (`shortestpath.workbench`), which reads the pull request
 * with git and diffs its transport and destination rows. Its paths mirror the page's, which mirror
 * GitHub's: `/github/<owner>/<repo>/pull/<n>/files/<base>..<head>` names one review for good, and
 * `/pull/<n>` is the pull request as it is now.
 */

export type ReviewSource =
  | { kind: "pull"; owner: string; repo: string; number: number; range?: { base: string; head: string } }
  | { kind: "compare"; owner: string; repo: string; base: string; head: string };

/** One data row of a TSV, by the column names in the file's header. */
export interface TransportRow {
  file: string;
  /** 1-based line in the file. */
  line: number;
  /** The nearest comment above the row (`## Trahaearn Mine`), without the `#`s. */
  section: string;
  fields: Record<string, string>;
  origin: WorldPoint | null;
  destination: WorldPoint | null;
  /** `menuOption menuTarget objectID`, or the destination file's `Info`. */
  label: string;
}

export interface FieldChange { name: string; before: string; after: string }
export type ChangeKind = "added" | "removed" | "changed";
export interface RowChange {
  kind: ChangeKind;
  base: TransportRow | null;
  head: TransportRow | null;
  /** For changed rows: the fields that differ, origin and destination included. */
  fields: FieldChange[];
}
export interface ReviewUnit {
  /** Stable for the same diff: file and first line. */
  id: string;
  file: string;
  title: string;
  changes: RowChange[];
}

export interface Review {
  repository: string;
  pull: number | null;
  /** The range compared: a tip of the base branch (or any base commit) and the head. */
  base: string;
  head: string;
  /** What the rows are compared against, as GitHub's "Files changed" does. */
  mergeBase: string;
  headSubject: string;
  counts: Record<ChangeKind, number>;
  units: ReviewUnit[];
}

export const row = (change: RowChange) => (change.head || change.base)!;

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
/** Branch names and SHAs as GitHub's compare URLs carry them (`master...feature/x`). */
const REF = /^[A-Za-z0-9_./-]{1,200}$/;
const SHA = "[0-9a-f]{40}";

export function parseSource(owner?: string, repo?: string, kind?: string, spec?: string, range?: string): ReviewSource | undefined {
  if (!owner || !repo || !spec || !NAME.test(owner) || !NAME.test(repo)) return undefined;
  if (kind === "pull" && /^\d{1,7}$/.test(spec)) {
    if (range === undefined) return { kind, owner, repo, number: Number(spec) };
    const match = new RegExp(`^(${SHA})\\.\\.(${SHA})$`).exec(range);
    return match ? { kind, owner, repo, number: Number(spec), range: { base: match[1], head: match[2] } } : undefined;
  }
  const [base, head, ...rest] = spec.split("...");
  if (kind === "compare" && head && !rest.length && REF.test(base) && REF.test(head)) return { kind, owner, repo, base, head };
  return undefined;
}

export const sourceLabel = (source: ReviewSource) => source.kind === "pull"
  ? `${source.owner}/${source.repo}#${source.number}` : `${source.owner}/${source.repo} ${source.base}...${source.head}`;

/** The path of a source, on the page and (under `/api/workbench/v1`) on the service. */
export function sourcePath(source: ReviewSource): string {
  const repo = `/github/${source.owner}/${source.repo}`;
  if (source.kind === "compare") return `${repo}/compare/${source.base}...${source.head}`;
  return `${repo}/pull/${source.number}${source.range ? `/files/${source.range.base}..${source.range.head}` : ""}`;
}

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/workbench/v1${path}`, { signal });
  if (!response.ok) {
    const message = await response.json().then(body => body?.error, () => undefined);
    throw new Error(message || `The review service answered ${response.status}.`);
  }
  return response.json();
}

export const loadReview = (source: ReviewSource, signal: AbortSignal) => get<Review>(sourcePath(source), signal);

/** Where the pull request's branches are now, for noticing a newer push. */
export const loadHeads = (source: ReviewSource & { kind: "pull" }, signal: AbortSignal) =>
  get<{ base: string; head: string }>(`/github/${source.owner}/${source.repo}/pull/${source.number}/heads`, signal);

/** An open pull request that changes transports or destinations, with the range its review compares. */
export interface OpenPull {
  number: number;
  title: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  base: string;
  head: string;
  counts: Record<ChangeKind, number>;
  units: number;
}
/** As the service last listed them (every few minutes); `refreshedAt` is null until its first listing. */
export interface OpenPulls { repository: string; refreshedAt: string | null; pulls: OpenPull[] }

export const loadOpenPulls = (owner: string, repo: string, signal: AbortSignal) =>
  get<OpenPulls>(`/github/${owner}/${repo}/pulls`, signal);

/** The review of an open pull request as listed, pinned to the push the list saw. */
export function openPullPath(repository: string, pull: OpenPull): string {
  const [owner, repo] = repository.split("/");
  return sourcePath({ kind: "pull", owner, repo, number: pull.number, range: { base: pull.base, head: pull.head } });
}

/** The pull request, or the compare range, on GitHub. */
export function githubUrl(review: Review): string {
  return review.pull !== null ? `https://github.com/${review.repository}/pull/${review.pull}`
    : `https://github.com/${review.repository}/compare/${review.base}...${review.head}`;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A line of exactly this diff on GitHub (a compare of the two commits, which stays put when the pull
 * request moves on): `R` for the head side, `L` for a removed line.
 */
export async function diffLineUrl(review: Review, path: string, line: number, side: "L" | "R"): Promise<string> {
  return `https://github.com/${review.repository}/compare/${review.mergeBase}...${review.head}#diff-${await sha256(path)}${side}${line}`;
}

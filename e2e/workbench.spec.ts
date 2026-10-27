import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import tiles from "../tiles.json" with { type: "json" };
import candidateFixture from "./fixtures/candidates.json" with { type: "json" };
import candidateTypes from "./fixtures/candidate-types.json" with { type: "json" };

// The workbench's transport review, on its own host, against a mocked review service: a pull
// request that adds the Fractured Archive entrance and edits a row. The pinned insets' labels lose
// The Fractured Archive's name, as before the entrance was merged, so the pull request names it.
// The collision layer has only the map square around the way in.
test.use({ baseURL: "http://workbench.localhost:5179" });

const FILE = "src/main/resources/transports/transports.tsv";
const BASE = "b".repeat(40), HEAD = "c".repeat(40), MERGE_BASE = "d".repeat(40), NEWER = "e".repeat(40);
const point = (x: number, y: number, plane: number) => ({ x, y, plane });
const transport = (line: number, section: string, origin: ReturnType<typeof point>, destination: ReturnType<typeof point>,
  label: string, fields: Record<string, string> = {}) => ({ file: FILE, line, section, origin, destination, label,
  fields: { Origin: `${origin.x} ${origin.y} ${origin.plane}`, Destination: `${destination.x} ${destination.y} ${destination.plane}`,
    "menuOption menuTarget objectID": label, ...fields } });
const REVIEW = {
  apiVersion: "workbench-review-v1", repository: "Skretzo/shortest-path", pull: 839, base: BASE, head: HEAD, mergeBase: MERGE_BASE,
  headSubject: "Add Fractured Archive entrance", counts: { added: 2, removed: 0, changed: 1 },
  units: [
    { id: "transports-3", file: FILE, title: "Tears of Guthix", changes: [{ kind: "changed",
      base: transport(3, "Tears of Guthix", point(3227, 9526, 2), point(3224, 9504, 2), "Attract Light creature 5435", { Items: "" }),
      head: transport(3, "Tears of Guthix", point(3227, 9526, 2), point(3224, 9504, 2), "Attract Light creature 5435", { Items: "Light source" }),
      fields: [{ name: "Items", before: "", after: "Light source" }] }] },
    { id: "transports-5", file: FILE, title: "The Fractured Archive entrance", changes: [
      { kind: "added", base: null, head: transport(5, "The Fractured Archive entrance", point(4053, 4568, 0), point(4127, 5508, 0), "Crawl-through Opening 62542"), fields: [] },
      { kind: "added", base: null, head: transport(6, "The Fractured Archive entrance", point(4127, 5508, 0), point(4053, 4568, 0), "Enter Opening 63009"), fields: [] }] },
  ],
};
const PULLS = { repository: "Skretzo/shortest-path", refreshedAt: new Date().toISOString(), pulls: [
  { number: 839, title: "Add Fractured Archive entrance", author: "someone", draft: false, updatedAt: "2026-10-23T00:00:00Z",
    base: BASE, head: HEAD, counts: REVIEW.counts, units: 2 },
  { number: 838, title: "Add Great Conch rowboats", author: "someone", draft: true, updatedAt: "2026-10-23T00:00:00Z",
    base: BASE, head: NEWER, counts: { added: 14, removed: 0, changed: 0 }, units: 3 },
] };
// Plane 0 of map square 63_71, at its zoom-8 tile address (63 - 15, 71 - 19).
const COLLISION = readFileSync(path.resolve(import.meta.dirname, "fixtures/collision/63_71")).subarray(0, 2048);

async function mockService(page: Page, { newer = false } = {}) {
  const review = "/api/workbench/v1/github/Skretzo/shortest-path/pull/839";
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === review || pathname === `${review}/files/${BASE}..${HEAD}`) return route.fulfill({ json: REVIEW });
    if (pathname === "/api/workbench/v1/github/Skretzo/shortest-path/pulls") return route.fulfill({ json: PULLS });
    if (pathname === `${review}/heads`) return route.fulfill({ json: { base: BASE, head: newer ? NEWER : HEAD } });
    // The route service isn't needed (only the inset map's optional plane links ask).
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${tiles.base}/collision/**`, route => route.request().url() === `${tiles.base}/collision/${tiles.version}/8/48/52.bin`
    ? route.fulfill({ body: COLLISION, contentType: "application/octet-stream" }) : route.fulfill({ status: 404 }));
}

/** The pinned inset release with `name`'s regions unnamed, the way a release from before they were reachable has them. */
async function unname(page: Page, name: string) {
  const bundle = `${tiles.base}/insets/${tiles.insets.version}`;
  let labels = "";
  await page.route(`${bundle}/manifest.json`, async route => {
    const manifest = await (await route.fetch()).json();
    const release = await (await page.request.get(`${bundle}/labels.json`)).json() as
      { regions: Record<string, { name: string; status: string; areas: unknown[] }> };
    for (const region of Object.values(release.regions)) {
      if (region.name === name) Object.assign(region, { name: "Unidentified terrain", status: "unresolved", areas: [] });
    }
    labels = JSON.stringify(release);
    manifest.files["labels.json"] = createHash("sha256").update(labels).digest("hex");
    await route.fulfill({ json: manifest });
  });
  await page.route(`${bundle}/labels.json`, route => route.fulfill({ body: labels, contentType: "application/json" }));
}

test("reviews a pull request's transport rows on the inset map", async ({ page }) => {
  await mockService(page);
  await unname(page, "The Fractured Archive");
  const collision = page.waitForRequest(`${tiles.base}/collision/${tiles.version}/p2/8/35/129.bin`);
  await page.goto("/github/Skretzo/shortest-path/pull/839");
  // The link names the push it shows, so it shows the same rows for good.
  await expect(page).toHaveURL(`/github/Skretzo/shortest-path/pull/839/files/${BASE}..${HEAD}`);
  await expect(page).toHaveTitle("Review Skretzo/shortest-path#839 · Workbench");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const units = page.getByRole("navigation", { name: "Changes" }).getByRole("button");
  await expect(units).toHaveText([/Tears of Guthix.*~1/, /The Fractured Archive entrance.*\+2/]);
  await expect(page.locator(".wb-summary")).toContainText("2 changes");

  // The edited row shows what changed.
  const rows = page.getByRole("region", { name: "Rows" });
  await expect(rows.locator("del")).toHaveText("∅");
  await expect(rows.locator("ins")).toHaveText("Light source");
  // The first change (in Tears of Guthix, plane 2) is drawn over the collision layer, which asks the release for its square.
  await collision;

  // j moves to the next change and records it in the URL; an area the insets haven't named takes the pull request's heading.
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/#unit=transports-5$/);
  await expect(page.locator(".inset-label", { hasText: "The Fractured Archive entrance (from PR)" })).toBeVisible();
  await expect(rows.getByRole("link", { name: "5" })).toHaveAttribute("href",
    new RegExp(`^https://github\\.com/Skretzo/shortest-path/compare/${MERGE_BASE}\\.\\.\\.${HEAD}#diff-[0-9a-f]{64}R5$`));
  await expect(page.locator(".wb-footer")).toContainText(`Tiles and collision ${tiles.version}`);
  await expect(page.locator(".wb-newer")).toHaveCount(0);

  // The map's style can be switched here too, on any screen.
  const style = page.getByRole("group", { name: "Map style" });
  await style.getByRole("button", { name: "Standard" }).click();
  await expect(style.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");

  // The landing tile of the way in can be shown on its own, with collision around it.
  await rows.getByRole("button", { name: "4127 5508 0" }).first().click();
  await expect(page.locator(".wb-rows tr.selected")).toHaveCount(1);
});

test("says when a link shows an older push", async ({ page }) => {
  await mockService(page, { newer: true });
  await page.goto(`/github/Skretzo/shortest-path/pull/839/files/${BASE}..${HEAD}`);
  await page.locator(".wb-newer").getByRole("link", { name: "Open the latest push" }).waitFor();
  await expect(page.locator(".wb-newer")).toContainText("This is an older push of the pull request.");
});

test("lists the open pull requests that change transports", async ({ page }) => {
  await mockService(page);
  await page.goto("/");
  const list = page.getByRole("region", { name: "Open pull requests" }).getByRole("link");
  await expect(list).toHaveText([/#839.*Add Fractured Archive entrance.*2 changes.*\+2/, /#838.*Add Great Conch rowboats.*draft.*3 changes/]);
  await expect(page.getByRole("region", { name: "Open pull requests" })).toContainText("Listed just now");
  await list.first().click();
  await expect(page).toHaveURL(`/github/Skretzo/shortest-path/pull/839/files/${BASE}..${HEAD}`);
  // The header's menu moves between them.
  const picker = page.getByRole("combobox", { name: "Open pull requests" });
  await expect(picker).toHaveValue("839");
  await picker.selectOption("838");
  await expect(page).toHaveURL(`/github/Skretzo/shortest-path/pull/838/files/${BASE}..${NEWER}`);
});

test("explains a URL that isn't a pull request", async ({ page }) => {
  await mockService(page);
  await page.goto("/");
  await page.getByLabel("GitHub URL").fill("https://example.com/nope");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("alert")).toHaveText("Paste a github.com pull request or compare URL.");
});

// Candidate review uses the same service mocking and the same real inset map as PR reviews.
const [CAPE, MEDALLION, STAIRS_UP, STAIRS_DOWN, OFFSET, DIVERGED] = candidateFixture.candidates;
type CandidateMap = {
  shows(point: { x: number; y: number; plane: number }): boolean;
  pixel(point: { x: number; y: number; plane: number }): number[];
  featureSummary(): { key: string; kind: string; tone: string; dashed: boolean }[];
};
const candidateMap = <T,>(page: Page, call: (handle: CandidateMap) => T) =>
  page.evaluate(`(${call.toString()})(window.insetMap)`) as Promise<T>;

async function mockCandidates(page: Page, data: unknown = candidateFixture) {
  await mockService(page);
  await page.route("**/api/workbench/v1/candidates", route => route.fulfill({ json: data }));
  await page.route(`${tiles.base}/collision/${tiles.version}/manifest.json`, route => route.fulfill({ json: {
    cacheId: 2746, dumperSource: { repository: "osrs-pathfinding/shortest-path-tooling", rev: "3".repeat(40) },
  } }));
  await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style", "tactical"));
}

async function openCandidate(page: Page, id: string, search = "") {
  await page.goto(`/candidates${search}#candidate=${id}`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { insetMap?: unknown }).insetMap));
  await expect(page.locator(".wb-candidate-detail.selected")).toHaveAttribute("data-candidate-id", id);
}

test("candidate plane change shows original and proposed floors, collision provenance and stable selection", async ({ page }) => {
  await mockCandidates(page);
  const oldCollision = page.waitForRequest(url => url.url().includes("/collision/") && url.url().endsWith("/8/29/27.bin"));
  const newCollision = page.waitForRequest(url => url.url().includes("/collision/") && url.url().endsWith("/p1/8/29/27.bin"));
  await openCandidate(page, CAPE.id, "?category=plane");
  await expect(page).toHaveTitle("Transport candidates · Workbench");
  await expect.poll(() => candidateMap(page, map => map.shows({ x: 2862, y: 2997, plane: 0 }))).toBe(true);
  await expect.poll(() => candidateMap(page, map => map.shows({ x: 2862, y: 2996, plane: 1 }))).toBe(true);
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "point").map(f => [f.tone, f.dashed]).sort()))
    .toEqual([["added", false], ["removed", true]]);
  await oldCollision; await newCollision;
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail).toContainText("plane 0 → 1");
  await expect(detail).toContainText("Other reported differences");
  await expect(page.getByRole("region", { name: "Candidate details" })).toContainText("cache 2735");
  await expect(page.getByRole("region", { name: "Candidate details" })).toContainText("cache 2746");
  await expect(page.locator(".wb-footer")).toContainText("1111111");
  await page.reload();
  await expect(page.locator(".wb-candidate-detail.selected")).toHaveAttribute("data-candidate-id", CAPE.id);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("#candidate=" + MEDALLION.id + "$"));
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp("#candidate=" + CAPE.id + "$"));
});

test("requirement corrections show verbatim fields and contributor item-group evidence", async ({ page }) => {
  await mockCandidates(page, candidateTypes);
  const c = candidateTypes.candidates.find(c => c.category === "missing_requirements")!;
  await openCandidate(page, c.id, "?category=missing_requirements");
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail.getByRole("table").filter({ hasText: "Items" })).toContainText("[light source]=1");
  await detail.getByText("Contributor item groups (1)", { exact: true }).click();
  await expect(detail).toContainText("Lit candle 33");
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "edge").map(f => f.tone))).toEqual(["changed"]);
  await expect(detail).toContainText("not evaluated capabilities");
});

test("unrepresentable requirements retain an original row without fabricating a replacement", async ({ page }) => {
  await mockCandidates(page, candidateTypes);
  const c = candidateTypes.candidates.find(c => c.category === "unrepresentable_requirements")!;
  await openCandidate(page, c.id);
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail).toContainText("no representable replacement row");
  await expect(detail).toContainText("quest Regicide started");
  await expect.poll(() => candidateMap(page, map => map.featureSummary().every(f => f.tone === "changed"))).toBe(true);
  await detail.getByText("Exact TSV rows and bundled correspondences", { exact: true }).click();
  await expect(detail).toContainText("No representable replacement supplied");
});

test("proposed new transports pair only their proposed directions and preserve unchecked evidence", async ({ page }) => {
  await mockCandidates(page, candidateTypes);
  const c = candidateTypes.candidates.find(c => c.category === "sourced_transport")!;
  await openCandidate(page, c.id, "?category=sourced_transport");
  await expect(page.locator(".wb-candidate-detail")).toHaveCount(2);
  await expect(page.getByRole("navigation", { name: "Candidates" })).toContainText("2 rows · 1 review units shown");
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail).toContainText("No original upstream row was supplied");
  await expect(detail).toContainText("Contributor ticks (unchecked): 10 (estimate)");
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "edge").map(f => f.tone))).toEqual(["added", "added"]);
  await detail.getByText("Exact TSV rows and bundled correspondences", { exact: true }).click();
  await expect(detail).toContainText("No upstream row supplied");
  await expect(detail).toContainText("Complete contributor record");
});

test("a network stop displays its boarding and landing tiles without inventing network edges", async ({ page }) => {
  await mockCandidates(page, candidateTypes);
  const c = candidateTypes.candidates.find(c => c.category === "network_stop")!;
  await openCandidate(page, c.id, "?category=network_stop");
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail.getByRole("cell", { name: "Board at", exact: true })).toBeVisible();
  await expect(detail.getByRole("cell", { name: "Land at", exact: true })).toBeVisible();
  await expect(detail).toContainText("Fairy ring");
  await expect(detail).toContainText("needs one of: item 772/9084 worn");
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "edge").length)).toBe(0);
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "point").length)).toBe(1);
  await expect(page.getByLabel("Geometry legend")).toContainText("no network routes implied");
});

test("new teleports and copied-area suggestions keep missing tile evidence explicit", async ({ page }) => {
  await mockCandidates(page, candidateTypes);
  const c = candidateTypes.candidates.find(c => c.category === "copied_area_teleport")!;
  await openCandidate(page, c.id);
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail).toContainText("Missing evidence — none recorded");
  await expect(detail).toContainText("quest or cutscene instance");
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "point").length)).toBe(1);
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "edge").length)).toBe(0);
});

test("large catalogues page navigation while keeping selection links stable", async ({ page }) => {
  const rows = Array.from({ length: 165 }, (_, i) => ({ ...candidateFixture.candidates[0], id: i.toString().padStart(24, "0") }));
  await mockCandidates(page, { ...candidateFixture, candidates: rows });
  await openCandidate(page, rows[0].id);
  const list = page.getByRole("navigation", { name: "Candidates" });
  await expect(list.locator("ol > li")).toHaveCount(80);
  await list.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("#candidate=" + rows[80].id + "$"));
  await expect(list).toContainText("Units 81–160 of 165");
  await page.reload();
  await expect(page.locator(".wb-candidate-detail.selected")).toHaveAttribute("data-candidate-id", rows[80].id);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(list.locator("ol > li")).toHaveCount(5);
});

test("non-floor reverse-paired staircase is one review unit and map features select its source row", async ({ page }) => {
  await mockCandidates(page);
  await openCandidate(page, STAIRS_UP.id, "?category=non_floor");
  const navigation = page.getByRole("navigation", { name: "Candidates" });
  await expect(navigation).toContainText("2 rows · 1 review units shown");
  await expect(navigation.locator("ol > li")).toHaveCount(1);
  await expect(page.locator(".wb-candidate-detail")).toHaveCount(2);
  await expect.poll(() => candidateMap(page, map => map.shows({ x: 1523, y: 3562, plane: 2 }))).toBe(true);
  await expect.poll(() => candidateMap(page, map => map.featureSummary().filter(f => f.kind === "edge").map(f => [f.tone, f.dashed]).sort()))
    .toEqual([["added", false], ["added", false], ["removed", true], ["removed", true]]);
  await page.getByRole("button", { name: "Climb Stairs 27202", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("#candidate=" + STAIRS_DOWN.id + "$"));
  await expect(page.locator(".wb-candidate-detail.selected")).toContainText("the start 1523,3563,1 is no floor");
  await expect(page.getByLabel("Geometry legend")).toContainText("Original: dashed");
  // Click the actual map using the established map handle's projection. The uppermost marker
  // belongs to the opposite direction, and must identify that source candidate.
  // Selection fits the map with an animation. Re-project for each attempt rather than retaining
  // a pixel from before that animation or an inset rebuild finished.
  await expect(async () => {
    const [x, y] = await candidateMap(page, map => map.pixel({ x: 1523, y: 3562, plane: 2 }));
    const bounds = await page.locator(".inset-map").boundingBox();
    await page.mouse.click(bounds!.x + x, bounds!.y + y);
    await expect(page).toHaveURL(new RegExp("#candidate=" + STAIRS_UP.id + "$"), { timeout: 500 });
  }).toPass({ timeout: 10000 });
  await expect(page.locator(".wb-candidate-detail.selected")).toHaveCount(1);
});

test("coordinate candidates retain unresolved reconciliation and checked-in decisions through filtering", async ({ page }) => {
  await mockCandidates(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Transport candidates", exact: true }).click();
  await expect(page).toHaveURL(/\/candidates/);
  await page.getByLabel("Category", { exact: true }).selectOption("coordinate_offset");
  await expect(page.locator(".wb-candidate-detail")).toHaveCount(2);
  await expect(page.locator(".wb-summary")).toContainText("6 suggestion rows · 0 destination violations · 4 review units");
  await page.getByLabel("Reconciliation status").selectOption("diverged");
  await expect(page.locator(".wb-candidate-detail", { hasText: DIVERGED.id })).toContainText("diverged");
  await page.getByLabel("Search candidates").fill("27200");
  await expect(page.locator(".wb-candidate-detail")).toHaveCount(2);
  await page.locator(`[data-candidate-id="${DIVERGED.id}"]`).getByRole("button", { name: "Climb Stairs 27200", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("#candidate=" + DIVERGED.id + "$"));
  await expect(page.locator(".wb-candidate-detail.selected")).toContainText("The starting row is unresolved or has changed");
  await expect(page.locator(".wb-candidate-detail.selected")).toContainText("tiles (Δx");
  await expect(page.locator(`[data-candidate-id="${OFFSET.id}"]`)).toBeVisible();
  await openCandidate(page, MEDALLION.id);
  await expect(page.locator(".wb-candidate-detail.selected")).toContainText("needs_evidence — Fixture: needs in-game verification");
});

test("developer coordinate hover copies surface and inset tiles and freezes the context-menu tile", async ({ page }) => {
  await mockCandidates(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } });
  });
  await openCandidate(page, CAPE.id, "?category=plane");
  const map = page.locator(".inset-map"), readout = page.locator(".map-coordinates");
  const hoverTile = async (point: { x: number; y: number; plane: number }) => {
    await page.waitForTimeout(400); // Wait for any fit animation before resolving screen pixels.
    const pixel = await page.evaluate(p => (window as unknown as { insetMap: CandidateMap }).insetMap.pixel(p), point);
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + pixel[0], box.y + pixel[1]);
    await expect(readout).toContainText(`${point.x} ${point.y} ${point.plane}`);
    return { x: box.x + pixel[0], y: box.y + pixel[1] };
  };
  await hoverTile({ x: 2862, y: 2997, plane: 0 });
  await page.keyboard.press("c");
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe("2862 2997 0");
  const inset = await hoverTile({ x: 2862, y: 2996, plane: 1 });
  await page.mouse.click(inset.x, inset.y, { button: "right" });
  await expect(page.locator(".map-coordinate-menu")).toContainText("2862 2996 1");
  await page.getByRole("button", { name: "Copy coordinates", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe("2862 2996 1");
  await expect(readout).toContainText("Copied");
  await page.getByLabel("Search candidates").fill("c");
  await expect(page.getByLabel("Search candidates")).toHaveValue("c");
});

test("destination violations show current evidence without suggesting a correction", async ({ page }) => {
  const violation = { ...CAPE, id: "destination-example", kind: "destination_violation", category: "destination_violation",
    suggested: null, suggestedRaw: "", whatChanges: "Blocked destination with no transport starting on that exact tile.",
    sourceRepository: "Skretzo/shortest-path", sourceCommit: "a".repeat(40), upstreamCommit: "a".repeat(40),
    reconciliation: { status: "violation", rows: [] } };
  await mockCandidates(page, { ...candidateFixture, candidates: [...candidateFixture.candidates, violation] });
  await openCandidate(page, violation.id, "?category=destination_violation");
  const detail = page.locator(".wb-candidate-detail.selected");
  await expect(detail).toContainText("No proposed correction yet");
  await expect(detail).toContainText("Current world coordinates");
  await expect(detail).not.toContainText("Contributor");
  await expect(detail).not.toContainText("Suggested");
  await expect(detail.getByRole("link").first()).toHaveAttribute("href", /Skretzo\/shortest-path\/blob\/a{40}/);
  await expect(page.locator(".wb-summary")).toContainText("1 destination violations");
});

test("unreachable area sizes filter candidates and survive reload", async ({ page }) => {
  const source = candidateTypes.candidates.find(c => c.category === "sourced_transport")!;
  const large = { ...source, id: "outside-large", category: "sourced_transport_outside_routing",
    unreachableAreas: { origin: null, destination: { tiles: 2400, atLeast: false } } };
  const tiny = { ...large, id: "outside-tiny", unreachableAreas: { origin: null, destination: { tiles: 4, atLeast: false } } };
  await mockCandidates(page, { ...candidateTypes, candidates: [large, tiny] });
  await openCandidate(page, large.id, "?areaSize=large");
  await expect(page.getByRole("navigation", { name: "Candidates" })).toContainText("1 rows · 1 review units shown");
  await expect(page.locator(".wb-candidate-detail.selected")).toContainText("destination: 2,400 tiles");
  await page.getByLabel("Unreachable area size", { exact: true }).selectOption("tiny");
  await expect(page).toHaveURL(/areaSize=tiny#candidate=outside-tiny/);
  await expect(page.locator(".wb-candidate-detail.selected")).toContainText("destination: 4 tiles");
  await page.reload();
  await expect(page.getByLabel("Unreachable area size", { exact: true })).toHaveValue("tiny");
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import tiles from "../tiles.json" with { type: "json" };

// The workbench's inset investigation over the pinned inset release (real regions, labels and
// anchors from tiles.collisionlab.world), with investigations.json and the topology report from
// checked-in fixtures that follow their contracts (src/features/workbench/investigation/data.ts and
// topology.ts): they name real regions, but their candidates and components are made up for tests.
test.use({ baseURL: "http://workbench.localhost:5179" });

const fixture = (name: string) => readFileSync(path.resolve(import.meta.dirname, "fixtures", name), "utf8");
const investigations = fixture("insets/investigations.json");
// The report was recorded on cache 2746; it claims the pinned tiles' cache so a new game cache leaves it verified.
const CACHE = Number(tiles.version.split("-")[0]);
const recorded = JSON.parse(fixture("insets/topology.json"));
const topology = { ...recorded, collision: { ...recorded.collision, cacheId: CACHE } };
const transports = JSON.parse(fixture("transports.json")) as {
  meta: unknown; transports: { id: string; label: string; origin: Point | null; destination: Point }[];
};
interface Point { x: number; y: number; plane: number }
const bundle = `${tiles.base}/insets/${tiles.insets.version}`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const TAVERLEY = "p0-2815-9671-fa8e6b76d2", TAVERLEY_UP = "p1-2770-9792-d5ff518273", NAMELESS = "p0-3648-8576-75e60686e8";

type Box = [plane: number, x1: number, y1: number, x2: number, y2: number];
const inBox = (p: Point | null, [plane, x1, y1, x2, y2]: Box) => !!p && p.plane === plane && p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;

/** The fixture made for `manifest`'s release: its hashes name that release's regions, labels and anchors,
 * so the fixture follows each new inset pin. */
function forRelease(file: string, manifest: { files: Record<string, string> }) {
  const json = JSON.parse(file) as Record<string, unknown>;
  return JSON.stringify({ ...json, catalogueSha256: manifest.files["regions.json"], labelsSha256: manifest.files["labels.json"],
    anchorsSha256: manifest.files["anchors.json"] });
}

/** Mocks: the release's manifest gains investigations.json (unless `investigationsFile` is null), made for that
 * release unless `asIs`; the service answers topology and transports. */
async function mock(page: Page, { investigationsFile = investigations as string | null, asIs = false, report = topology as unknown, reportStatus = 200 } = {}) {
  let served = investigationsFile;
  await page.route(`${bundle}/manifest.json`, async route => {
    const manifest = await (await route.fetch()).json();
    if (investigationsFile !== null) {
      served = asIs ? investigationsFile : forRelease(investigationsFile, manifest);
      manifest.files["investigations.json"] = sha256(served);
    }
    await route.fulfill({ json: manifest });
  });
  if (investigationsFile !== null) await page.route(`${bundle}/investigations.json`, route => route.fulfill({ body: served!, contentType: "application/json" }));
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/workbench/v1/topology") return reportStatus === 200 ? route.fulfill({ json: report })
      : route.fulfill({ status: reportStatus, json: { error: "this build has no topology report from shortest-path-tooling" } });
    const rest = url.pathname.replace("/api/workbench/v1/transports", "");
    if (rest === "/meta") return route.fulfill({ json: transports.meta });
    if (rest === "" && url.searchParams.get("view")) {
      const boxes = url.searchParams.get("view")!.split(";").map(part => part.split(",").map(Number) as Box);
      const found = transports.transports.filter(t => boxes.some(box => inBox(t.origin, box) || inBox(t.destination, box)));
      return route.fulfill({ json: { total: found.length, transports: found } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  await page.route(`${tiles.base}/collision/${tiles.version}/manifest.json`, route => route.fulfill({ json: {
    layer: "collision", cacheId: CACHE, dumperSource: { repository: "osrs-pathfinding/shortest-path-tooling", rev: "e615afa705469cdb541c496f1fe99d7ce7e5d4e5" } } }));
  await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style", "tactical"));
}

type Handle = { featureCount(): Record<string, number>; centreTile(): { point: Point; zoom: number }; shows(point: Point): boolean; pixel(point: Point): number[] };
/** Calls the map's test handle in the page; `call` is sent as source, so it may only use its argument. */
const map = <T,>(page: Page, call: (handle: Handle) => T) => page.evaluate(`(${call.toString()})(window.insetMap)`) as Promise<T>;
const masks = (page: Page) => map(page, handle => handle.featureCount().mask);
const centre = (page: Page) => map(page, handle => handle.centreTile());

async function open(page: Page, query: string) {
  await page.goto(`/insets${query}`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { insetMap?: unknown }).insetMap));
}
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });

test("shows a named dungeon's regions by their terrain and switches its planes in place", async ({ page }) => {
  await mock(page);
  await open(page, "");
  await page.getByRole("navigation", { name: "Areas" }).getByRole("button", { name: /Taverley Dungeon/ }).click();
  await expect(page).toHaveURL(/area=area:taverley-dungeon/);
  await expect(details(page).getByRole("heading", { name: "Taverley Dungeon" })).toBeVisible();
  await expect.poll(() => masks(page)).toBe(1);
  await expect.poll(() => map(page, handle => handle.shows({ x: 2907, y: 9706, plane: 0 }))).toBe(true);
  await page.waitForTimeout(500);
  const before = await centre(page);
  await page.getByRole("group", { name: "Plane shown" }).getByRole("button", { name: "Plane 1" }).click();
  await expect(page).toHaveURL(/plane=1/);
  // Both plane-1 regions are drawn by their masks, the view where it was: planes share coordinates.
  await expect.poll(() => masks(page)).toBe(2);
  await expect.poll(() => map(page, handle => handle.shows({ x: 2791, y: 9819, plane: 1 }))).toBe(true);
  const after = await centre(page);
  expect(Math.abs(after.point.x - before.point.x) + Math.abs(after.point.y - before.point.y)).toBeLessThan(3);
  await details(page).getByRole("tab", { name: "Labelling" }).click();
  await expect(details(page).getByRole("cell", { name: TAVERLEY_UP })).toBeVisible();
});

test("shows a region with no name or entrance where it really is, joined to nothing", async ({ page }) => {
  await mock(page);
  await open(page, "");
  const browser = page.getByRole("navigation", { name: "Areas" });
  await browser.getByLabel("Search areas").fill("3648");
  await browser.getByRole("button", { name: /Unidentified terrain at 3648, 8576/ }).click();
  await expect(page).toHaveURL(new RegExp(`area=region:${NAMELESS}`));
  await expect(page.getByRole("status", { name: "Inspected tile" })).toContainText("placement unknown");
  await expect.poll(() => masks(page)).toBe(1);
  // In place: its own coordinates are on the map, and the tile under the view's centre is in it.
  await expect.poll(() => map(page, handle => handle.shows({ x: 3711, y: 8703, plane: 0 }))).toBe(true);
  await expect.poll(async () => { const { point } = await centre(page);
    return point.plane === 0 && point.x >= 3648 && point.x <= 3776 && point.y >= 8576 && point.y <= 8767; }).toBe(true);
  // "Beside entrance" has no entrance to use, so it stays where it is.
  await page.getByRole("button", { name: "Beside entrance" }).click();
  await expect.poll(() => map(page, handle => handle.shows({ x: 3711, y: 8703, plane: 0 }))).toBe(true);
  await details(page).getByRole("tab", { name: "Labelling" }).click();
  await expect(details(page)).toContainText("placement unknown. No anchor or entrance is known");
  await expect(details(page).getByText("suggestion").first()).toBeVisible();
});

/** Where a tile is drawn once the map has settled: the same pixel twice running. */
async function settledPixel(page: Page, point: Point) {
  let last: number[] | null = null;
  await expect.poll(async () => {
    const now = await page.evaluate(p => (window as unknown as { insetMap: Handle }).insetMap.pixel(p), point) as number[] | null;
    const settled = !!now && JSON.stringify(now) === JSON.stringify(last);
    last = now;
    return settled;
  }, { intervals: [250] }).toBe(true);
  return last!;
}

test("selects a region by clicking its terrain and reports the tile", async ({ page }) => {
  await mock(page);
  await open(page, "?area=area:taverley-dungeon&plane=1&mode=labelling");
  await expect.poll(() => masks(page)).toBe(2);
  const [x, y] = await settledPixel(page, { x: 2962, y: 9800, plane: 1 });
  await page.locator(".inset-map").click({ position: { x, y } });
  await expect(page).toHaveURL(/region=p1-2887-9797-df2334d7b8/);
  await expect(page.getByRole("status", { name: "Inspected tile" })).toContainText("2962 9800 1");
  await expect(details(page).locator("tr.selected")).toContainText("p1-2887-9797-df2334d7b8");
});

test("inspects a candidate link between two regions, with its evidence and rows", async ({ page }) => {
  await mock(page);
  await open(page, `?area=area:taverley-dungeon&region=${TAVERLEY}`);
  const panel = details(page);
  await panel.getByText("Checks and what “reached” means").click();
  await expect(panel.getByText(`cache ${CACHE}, as the insets`)).toBeVisible();
  await panel.getByRole("button", { name: /2905 9681 0 → 2791 9819 1/ }).click();
  await expect(page).toHaveURL(/sel=cand:k-taverley-upper/);
  const candidate = panel.getByRole("region", { name: "Selected candidate" });
  await expect(candidate).toContainText("supported");
  await expect(candidate).toContainText("plane 0");
  await expect(candidate).toContainText("plane 1");
  await expect(candidate).toContainText("No chain of transports reaches this walking component.");
  await expect(candidate.getByRole("link", { name: "transports.tsv:1330" }).first())
    .toHaveAttribute("href", "https://github.com/Skretzo/shortest-path/blob/12728cca1857ff25e40f92cecd10ff08970d6d32/src/main/resources/transports/transports.tsv#L1330");
  // Both ends are drawn: the far end's region is laid out too, and the candidate is an edge.
  await expect.poll(() => map(page, handle => handle.shows({ x: 2791, y: 9819, plane: 1 }))).toBe(true);
  await expect.poll(async () => (await map(page, handle => handle.featureCount())).edge).toBeGreaterThan(0);
});

test("flags a candidate with insufficient evidence as a lead", async ({ page }) => {
  await mock(page);
  await open(page, "?area=area:taverley-dungeon&sel=cand:k-taverley-hunch");
  const candidate = details(page).getByRole("region", { name: "Selected candidate" });
  await expect(candidate).toContainText("insufficient evidence");
  await expect(candidate).toContainText("none: this is a lead to check in game, not a finding");
});

test("lists a correctly mapped dungeon's several walking components without calling them gaps", async ({ page }) => {
  await mock(page);
  await open(page, "?area=area:cerberus-lair");
  const panel = details(page);
  const table = panel.getByRole("region", { name: "Walking components" }).getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(table.locator(".wb-bad")).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "Candidate links" })).toContainText("None.");
  const browser = page.getByRole("navigation", { name: "Areas" });
  await expect(browser.getByRole("button", { name: /Cerberus' Lair/ }).locator(".wb-flag.gap")).toHaveCount(0);
  await expect(browser.getByRole("button", { name: /Taverley Dungeon/ }).locator(".wb-flag.gap")).toHaveCount(1);
  // Taverley's tiny fragment is counted, not drawn as a problem.
  await browser.getByRole("button", { name: /Taverley Dungeon/ }).click();
  await expect(panel.getByRole("region", { name: "Walking components" })).toContainText("1 small fragment not shown");
});

test("switches modes keeping the area, its regions and the view", async ({ page }) => {
  await mock(page);
  await open(page, "?area=area:taverley-dungeon&at=2890,9760,0&z=8");
  await expect.poll(() => masks(page)).toBe(1);
  await page.waitForTimeout(500);
  const before = await centre(page);
  await details(page).getByRole("tab", { name: "Labelling" }).click();
  await expect(page).toHaveURL(/mode=labelling/);
  await expect(page).toHaveURL(/area=area:taverley-dungeon/);
  await expect(details(page).getByRole("region", { name: "Evidence" })).toBeVisible();
  expect(await masks(page)).toBe(1);
  expect(await centre(page)).toEqual(before);
  await details(page).getByRole("tab", { name: "Topology" }).click();
  expect(await centre(page)).toEqual(before);
});

test("selects evidence and shows its source coordinates", async ({ page }) => {
  await mock(page);
  await open(page, `?area=region:${NAMELESS}&mode=labelling`);
  const panel = details(page);
  await panel.getByRole("button", { name: /Fixture Caverns 3711 8703 0/ }).click();
  await expect(page).toHaveURL(/sel=ev:s-fixture-label/);
  const callout = panel.getByRole("note", { name: "Selected evidence" });
  await expect(callout).toContainText("suggested");
  await expect(callout).toContainText("source coordinate 3711 8703 0");
  await expect(callout).toContainText("Marked on the map.");
  // Accepted evidence, from the release's labels.
  await open(page, "?area=area:taverley-dungeon&mode=labelling");
  const row = panel.getByRole("region", { name: "Evidence" }).locator("tbody tr").first();
  const coordinate = await row.locator("td").nth(2).textContent();
  await row.click();
  await expect(panel.getByRole("note", { name: "Selected evidence" })).toContainText(`source coordinate ${coordinate}`);
});

test("restores a shared link: area, region, mode, item, plane and view", async ({ page }) => {
  await mock(page);
  const region = "p1-2887-9797-df2334d7b8";
  await open(page, `?area=area:taverley-dungeon&region=${region}&mode=labelling&sel=ev:s-b8dc7a9e8fe9d2d4&plane=1&at=2962,9800,1&z=9&v=${tiles.insets.version.slice(0, 12)}`);
  const panel = details(page);
  await expect(panel.getByRole("tab", { name: "Labelling" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator("tr.selected", { hasText: region })).toHaveCount(1);
  await expect(panel.getByRole("note", { name: "Selected evidence" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Plane shown" }).getByRole("button", { name: "Plane 1" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => centre(page)).toEqual({ point: { x: 2962, y: 9800, plane: 1 }, zoom: 9 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  // A link from another release says so.
  await open(page, "?area=area:taverley-dungeon&v=000000000000");
  await expect(page.getByRole("alert").filter({ hasText: "made for inset release 000000000000" })).toBeVisible();
});

test("refuses investigation data made from another release, and keeps working from the labels", async ({ page }) => {
  const other = JSON.stringify({ ...JSON.parse(investigations), catalogueSha256: "0".repeat(64) });
  await mock(page, { investigationsFile: other, asIs: true });
  await open(page, "");
  await expect(page.getByRole("alert").filter({ hasText: "investigations.json was not used: investigations.json was made from another regions.json" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Areas" }).locator(".wb-list-heading")).toContainText(/[1-9],\d{3} areas/);
});

test("marks a report from another cache or plugin as unverified", async ({ page }) => {
  await mock(page, { report: { ...topology, collision: { ...topology.collision, cacheId: 2700 }, plugin: { ...topology.plugin, rev: "f".repeat(40) } } });
  await open(page, "?area=area:taverley-dungeon&sel=cand:k-taverley-upper");
  const panel = details(page);
  await expect(panel.getByRole("alert")).toContainText("Unverified");
  await expect(panel).toContainText(`report flooded cache 2700, but these insets were cut from cache ${CACHE}`);
  await expect(panel).toContainText("the explorer shows @12728cc");
  await expect(panel.getByRole("region", { name: "Selected candidate" })).toContainText("unverified report");
  await expect(page.locator(".wb-footer")).toContainText("unverified against this page");
});

test("works without a topology report and says it is unavailable", async ({ page }) => {
  await mock(page, { reportStatus: 404 });
  await open(page, "?area=area:taverley-dungeon");
  const panel = details(page);
  // Nothing about the report in the panel; the connections still are.
  await expect(panel.getByRole("region", { name: "Topology report" })).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "Ways in" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Walking components" })).toHaveCount(0);
  await panel.getByRole("tab", { name: "Labelling" }).click();
  await expect(panel.getByRole("region", { name: "Evidence" }).locator("tbody tr").first()).toBeVisible();
  await expect(page.locator(".wb-footer")).toContainText("Topology unavailable");
});

test("works without investigations.json, from the release's own labels", async ({ page }) => {
  await mock(page, { investigationsFile: null });
  await open(page, "?area=area:taverley-dungeon&mode=labelling");
  await expect(details(page).getByRole("region", { name: "Name candidates" })).toContainText("Unavailable: This inset release has no investigations.json");
  await expect(details(page).getByRole("region", { name: "Related areas" })).toContainText("joined by the release's connections");
});

test("investigates a new link by hand and drafts a row without inventing its fields", async ({ page }) => {
  await mock(page);
  await open(page, "?area=area:taverley-dungeon");
  const panel = details(page);
  await panel.getByText("Investigate a new link", { exact: true }).click();
  const link = panel.getByRole("region", { name: "Investigate a new link" });
  await link.getByLabel("origin tile").fill("2905 9681 0");
  await link.getByLabel("destination tile").fill("2791 9819 1");
  await expect(link).toContainText(TAVERLEY);
  await expect(link).toContainText(TAVERLEY_UP);
  await expect(link).toContainText("w-taverley-pocket");
  await expect(link).toContainText(/Collision(blocked|open|no walkable)/);
  await expect(link.getByRole("status")).toContainText("No known transport joins these tiles");
  const draft = link.getByLabel("Transport draft");
  await expect(draft).toContainText("2905 9681 0\t2791 9819 1\tINVESTIGATE(menu option, target and object id)");
  await expect(draft).toContainText("INVESTIGATE(duration in ticks)");
  // A link that exists is recognised.
  const trapdoor = transports.transports.find(t => t.label === "Climb-down Trapdoor 6435")!;
  const text = (p: Point) => `${p.x} ${p.y} ${p.plane}`;
  await link.getByLabel("origin tile").fill(text(trapdoor.origin!));
  await link.getByLabel("destination tile").fill(text(trapdoor.destination));
  await expect(link.getByRole("status")).toContainText("Already known: Climb-down Trapdoor 6435");
  // Picking on the map sets the end clicked.
  await link.getByRole("button", { name: "Pick the origin on the map" }).click();
  await expect(page.getByRole("status", { name: "Inspected tile" })).toContainText("choose the origin");
});

test("drafts an annotation only from what the developer chose", async ({ page }) => {
  await mock(page);
  await open(page, `?area=region:${NAMELESS}&mode=labelling`);
  const form = details(page).getByRole("group", { name: "Correction draft" });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Fixture Caverns");
  await expect(form.getByLabel("Area key")).toHaveValue("fixture-caverns");
  const problems = details(page).getByLabel("Draft problems");
  await expect(problems).toContainText("Choose the evidence the name rests on; none is chosen for you.");
  await form.getByLabel("Region").selectOption(NAMELESS);
  await form.getByRole("checkbox", { name: /s-fixture-label/ }).check();
  await form.getByLabel("Justification").fill("The map label lies inside this terrain.");
  await expect(problems).toContainText("Choose a seed tile");
  await form.getByRole("button", { name: "Pick the seed tile on the map" }).click();
  await page.waitForTimeout(500);
  const [x, y] = await settledPixel(page, { x: 3711, y: 8703, plane: 0 });
  await page.locator(".inset-map").click({ position: { x, y } });
  const draft = details(page).getByLabel("Annotation draft");
  await expect(draft).toContainText(`"componentId": "${NAMELESS}"`);
  await expect(draft).toContainText(`"key": "fixture-caverns"`);
  await expect(draft).toContainText(`"s-fixture-label"`);
});

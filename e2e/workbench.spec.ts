import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import tiles from "../tiles.json" with { type: "json" };

// The workbench's transport review, on its own host, against a mocked review service: a pull
// request that adds the Fractured Archive entrance (an area the pinned insets haven't named) and
// edits a row. The collision layer has only the map square around the way in.
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

test("reviews a pull request's transport rows on the inset map", async ({ page }) => {
  await mockService(page);
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

  // j moves to the next change and records it in the URL; an area the insets haven't named takes the pull request's heading.
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/#unit=transports-5$/);
  await expect(page.locator(".inset-label", { hasText: "The Fractured Archive entrance (from PR)" })).toBeVisible();
  await expect(rows.getByRole("link", { name: "5" })).toHaveAttribute("href",
    new RegExp(`^https://github\\.com/Skretzo/shortest-path/compare/${MERGE_BASE}\\.\\.\\.${HEAD}#diff-[0-9a-f]{64}R5$`));
  await expect(page.locator(".wb-footer")).toContainText(`Tiles and collision ${tiles.version}`);
  await expect(page.locator(".wb-newer")).toHaveCount(0);
  // The first change (in Tears of Guthix, plane 2) asked the release's collision layer for its square.
  await collision;

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

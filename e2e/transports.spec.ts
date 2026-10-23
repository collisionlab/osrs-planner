import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import tiles from "../tiles.json" with { type: "json" };

// The workbench's transport explorer against a mocked catalogue: real transports around Lumbridge
// Castle (its staircase climbs planes 0-2), the Lumbridge teleports, the Draynor Sewers trapdoor and
// a fairy ring pairing, captured from the service (shortestpath.workbench.TransportCatalog). Map
// tiles, insets and collision come from the pinned tiles release.
test.use({ baseURL: "http://workbench.localhost:5179" });

interface Point { x: number; y: number; plane: number }
interface Summary { id: string; type: string; label: string; origin: Point | null; destination: Point; teleport: boolean; construction: string }
const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures/transports.json"), "utf8")) as {
  meta: { tooling: { rev: string }; plugin: { rev: string }; viewLimit: number }; transports: Summary[]; details: Record<string, Summary>;
};
const find = (test: (summary: Summary) => boolean) => fixture.transports.find(test)!;
const upstairs = find(t => t.label === "Climb-up Staircase 16671" && t.origin?.plane === 0 && t.destination.plane === 1);
const homeTeleport = find(t => t.type === "TELEPORTATION_SPELL_HOME");
const trapdoor = find(t => t.label === "Climb-down Trapdoor 6435");
const ring = find(t => t.construction === "paired");

type Box = [plane: number, x1: number, y1: number, x2: number, y2: number];
const inBox = (p: Point | null, [plane, x1, y1, x2, y2]: Box) => !!p && p.plane === plane && p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;

/** A grid of doors filling a box, to stand in for a dense part of the world. */
function network(box: Box, count: number): Summary[] {
  const [plane, x1, y1, x2, y2] = box, side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => {
    const x = x1 + Math.floor((i % side) * (x2 - x1) / side), y = y1 + Math.floor(Math.floor(i / side) * (y2 - y1) / side);
    return { id: (0x100000000000 + i).toString(16), type: "TRANSPORT", label: `Open Door ${i}`, origin: { x, y, plane },
      destination: { x: x + 1, y, plane }, teleport: false, construction: "row", file: "src/main/resources/transports/transports.tsv", remappedFrom: null } as Summary;
  });
}

/** Mocks the catalogue; `dense` answers every view with as many transports as a view lists, or counts past that. */
async function mockCatalogue(page: Page, { dense = false, collisionRev = "e615afa705469cdb541c496f1fe99d7ce7e5d4e5" } = {}) {
  const views: Box[][] = [];
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const url = new URL(route.request().url());
    const rest = url.pathname.replace("/api/workbench/v1/transports", "");
    if (!url.pathname.startsWith("/api/workbench/v1/transports")) return route.fulfill({ status: 404, json: {} });
    const types = url.searchParams.get("types")?.split(",").filter(Boolean);
    const typed = (list: Summary[]) => types ? list.filter(t => types.includes(t.type)) : list;
    if (rest === "/meta") return route.fulfill({ json: fixture.meta });
    if (rest === "/search") {
      const q = url.searchParams.get("q")!.toLowerCase();
      return route.fulfill({ json: typed(fixture.transports).filter(t => t.label.toLowerCase().includes(q)).slice(0, 50) });
    }
    if (rest === "") {
      const boxes = url.searchParams.get("view")!.split(";").map(part => part.split(",").map(Number) as Box);
      views.push(boxes);
      // One door per 40 tiles: hundreds close up, thousands zoomed out.
      const all = dense ? boxes.flatMap(box => network(box, Math.min(5000, Math.max(50, Math.round((box[3] - box[1]) * (box[4] - box[2]) / 40))))) : fixture.transports;
      const found = typed(all).filter(t => boxes.some(box => inBox(t.origin, box) || inBox(t.destination, box)));
      if (found.length <= fixture.meta.viewLimit) return route.fulfill({ json: { total: found.length, transports: found, clusters: [] } });
      // Too many: counted in quarters of each box, as the service does in cells.
      const clusters = boxes.flatMap(([plane, x1, y1, x2, y2]) => [0, 1, 2, 3].map(q => {
        const cx = q % 2 ? (x1 + x2) >> 1 : x1, cy = q > 1 ? (y1 + y2) >> 1 : y1;
        return { plane, x1: cx, y1: cy, x2: cx + ((x2 - x1) >> 1), y2: cy + ((y2 - y1) >> 1), count: Math.ceil(found.length / 4) };
      }));
      return route.fulfill({ json: { total: found.length, transports: [], clusters } });
    }
    const detail = fixture.details[decodeURIComponent(rest.slice(1))];
    return detail ? route.fulfill({ json: detail }) : route.fulfill({ status: 404, json: { error: "no transport" } });
  });
  await page.route(`${tiles.base}/collision/${tiles.version}/manifest.json`, route => route.fulfill({ json: {
    layer: "collision", cacheId: 2746, dumperSource: { repository: "osrs-pathfinding/shortest-path-tooling", rev: collisionRev } } }));
  await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style", "tactical"));
  return views;
}

type InsetMapHandle = { featureCount(): Record<string, number>; centreTile(): { point: Point; zoom: number } };
const featureCount = (page: Page) => page.evaluate(() => (window as unknown as { insetMap: InsetMapHandle }).insetMap.featureCount());

async function open(page: Page, query: string) {
  await page.goto(`/transports${query}`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { insetMap?: unknown }).insetMap));
}

test("selects a transport in view and shows the plugin's transport beside its source row", async ({ page }) => {
  const views = await mockCatalogue(page);
  await open(page, "?at=3210,3214,0&z=9");
  const list = page.getByRole("navigation", { name: "Transports" });
  await expect(list.locator(".wb-list-heading")).toContainText(/[1-9]\d* in view/);
  // Only what is in view was asked for: boxes around the castle, never the world.
  expect(views.at(-1)!.every(([, x1, y1, x2, y2]) => x2 - x1 < 400 && y2 - y1 < 400)).toBe(true);
  await list.getByRole("button", { name: new RegExp(`Climb-up Staircase 16671\\s*${upstairs.origin!.x} ${upstairs.origin!.y} 0`) }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]t=${upstairs.id}`));
  const detail = page.getByRole("region", { name: "Transport" });
  await expect(detail).toContainText(`${upstairs.destination.x} ${upstairs.destination.y} 1`);
  const source = detail.getByRole("link", { name: /transports\.tsv:\d+/ });
  await expect(source).toHaveAttribute("href", new RegExp(`^https://github.com/Skretzo/shortest-path/blob/${fixture.meta.plugin.rev}/src/main/resources/transports/transports.tsv#L\\d+$`));
  // Upstairs is another plane: its floor opens as an inset, with the staircase's edge into it.
  await expect(page.locator(".inset-label", { hasText: "Plane 1" })).toBeVisible();
  await expect.poll(async () => (await featureCount(page)).edge).toBeGreaterThan(0);
});

test("shows a teleport's landing without making up an origin", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, `?t=${homeTeleport.id}`);
  const detail = page.getByRole("region", { name: "Transport" });
  await expect(detail).toContainText("Lumbridge Home Teleport");
  await expect(detail.locator("dd").first()).toHaveText(`anywhere → ${homeTeleport.destination.x} ${homeTeleport.destination.y} 0`);
  await expect(page.getByRole("navigation", { name: "Transports" })).toContainText(`anywhere → ${homeTeleport.destination.x} ${homeTeleport.destination.y} 0`);
});

test("lists every transport arriving at or leaving a clicked tile, teleports included", async ({ page }) => {
  await mockCatalogue(page);
  const tile = homeTeleport.destination;
  await open(page, `?at=${tile.x},${tile.y},${tile.plane}&z=10`);
  await expect(page.getByRole("navigation", { name: "Transports" }).locator(".wb-list-heading")).toContainText(/in view/);
  const [x, y] = await page.evaluate(p => (window as unknown as { insetMap: { pixel(p: Point): number[] } }).insetMap.pixel(p), tile);
  await page.locator(".inset-map").click({ position: { x, y } });
  const list = page.getByRole("navigation", { name: "Transports" });
  await expect(list.locator(".wb-list-heading")).toContainText(`At ${tile.x} ${tile.y} ${tile.plane}`);
  const arriving = list.getByRole("region", { name: "Arriving here" });
  const expected = fixture.transports.filter(t => t.destination.x === tile.x && t.destination.y === tile.y && t.destination.plane === tile.plane);
  await expect(arriving.locator("h3 small")).toHaveText(String(expected.length));
  await expect(arriving).toContainText("Lumbridge Home Teleport");
  await list.getByRole("button", { name: "back to all in view" }).click();
  await expect(list.locator(".wb-list-heading")).toContainText(/in view/);
});

test("filters by type, and keeps the filter in the URL", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3210,3214,0&z=9");
  const list = page.getByRole("navigation", { name: "Transports" });
  await list.getByText(/^Types/).click();
  await list.getByRole("button", { name: "None" }).click();
  await expect(list.locator(".wb-list-heading")).toHaveText("0 in view");
  await expect.poll(async () => Object.values(await featureCount(page)).reduce((a, b) => a + b, 0)).toBe(0);
  await list.getByRole("checkbox", { name: /Teleportation spell home/ }).check();
  await expect(page).toHaveURL(/types=TELEPORTATION_SPELL_HOME/);
  await expect(list.locator("ol button").first()).toContainText("Lumbridge Home Teleport");
  await expect(list.locator("ol button", { hasText: "Staircase" })).toHaveCount(0);
});

test("opens shared links to a transport or a place, and finds transports by object id", async ({ page }) => {
  await mockCatalogue(page);
  // A transport into the Draynor Sewers: the sewers are laid out beside the trapdoor.
  await open(page, `?t=${trapdoor.id}`);
  const detail = page.getByRole("region", { name: "Transport" });
  await expect(detail).toContainText("Climb-down Trapdoor 6435");
  await expect(detail).toContainText("Draynor Sewers");
  await expect.poll(async () => (await featureCount(page)).edge).toBeGreaterThan(0);

  await open(page, "?at=3205,3209,0&z=10");
  await expect.poll(() => page.evaluate(() => (window as unknown as { insetMap: InsetMapHandle }).insetMap.centreTile()))
    .toMatchObject({ point: { x: 3205, y: 3209, plane: 0 }, zoom: 10 });
  const list = page.getByRole("navigation", { name: "Transports" });
  await page.getByLabel("Search transports").fill("6435");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(/q=6435/);
  await expect(list.locator(".wb-list-heading")).toContainText("found for “6435”");
  await expect(list.locator("ol button").first()).toContainText("Climb-down Trapdoor 6435");
});

test("shows a network transport as the pairing of an origin row and a destination row", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, `?t=${ring.id}`);
  const detail = page.getByRole("region", { name: "Transport" });
  // Both rows it was paired from.
  await expect(detail.locator(".wb-source")).toHaveCount(2);
  await expect(detail.locator(".wb-source").nth(0)).toContainText("(origin)");
  await expect(detail.locator(".wb-source").nth(1)).toContainText("(destination)");
});

test("says when collision wasn't made from the transport data's revision", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3210,3214,0&z=9");
  const footer = page.locator(".wb-provenance");
  await expect(footer).toContainText(fixture.meta.plugin.rev.slice(0, 7));
  await expect(footer.locator(".wb-prov.differs")).toHaveAttribute("title", /walls may not match/);
  await expect(footer).toContainText(`Insets ${tiles.insets.version.slice(0, 12)}`);
});

test("trusts collision made from the same revision", async ({ page }) => {
  await mockCatalogue(page, { collisionRev: fixture.meta.tooling.rev });
  await open(page, "?at=3210,3214,0&z=9");
  await expect(page.locator(".wb-provenance")).toContainText("Collision");
  await expect(page.locator(".wb-provenance .wb-prov.differs")).toHaveCount(0);
});

test("stays bounded over a dense network, and counts instead of drawing when zoomed out", async ({ page }) => {
  await mockCatalogue(page, { dense: true });
  await open(page, "?at=3210,3214,0&z=9");
  const list = page.getByRole("navigation", { name: "Transports" });
  await expect(list.locator(".wb-list-heading")).toContainText(/[1-9]\d* in view/);
  await expect.poll(async () => (await featureCount(page)).point).toBeGreaterThan(0);
  const close = await featureCount(page);
  // Each listed transport is at most an edge and two tiles; the list itself stops at 200.
  expect(close.edge + close.point).toBeLessThanOrEqual(3 * fixture.meta.viewLimit);
  expect(close.point).toBeGreaterThan(0);
  expect(await list.locator("ol li").count()).toBeLessThanOrEqual(200);

  await open(page, "?at=3000,3300,0&z=5");
  await expect(list.locator(".wb-list-heading")).toContainText("zoom in");
  await expect.poll(async () => (await featureCount(page)).region).toBeGreaterThan(0);
  const far = await featureCount(page);
  expect(far.edge + far.point).toBe(0);
  expect(far.region).toBeLessThanOrEqual(4 * 24);
});

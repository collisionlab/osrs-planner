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

const RINGS = { id: "FAIRY_RING:0", type: "FAIRY_RING", name: "Fairy rings", hub: { x: 3112, y: 3160, plane: 0 }, stations: [
  { point: { x: 2412, y: 4434, plane: 0 }, name: "Zanaris" }, { point: { x: 3108, y: 3149, plane: 0 }, name: "D I S" }, { point: { x: 2644, y: 3495, plane: 0 }, name: "A L S" }] };

const DRAYNOR = { id: "draynor-village@3091,3242,0", name: "Draynor Village", tiles: [{ x: 3091, y: 3242, plane: 0 }, { x: 3091, y: 3243, plane: 0 }],
  needs: [{ kind: "quest", name: "Some Quest" }] };

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

/** Mocks the catalogue; `dense` answers every view with a door every 40 tiles, only counted past the view limit. */
async function mockCatalogue(page: Page, { dense = false, collisionRev = "e615afa705469cdb541c496f1fe99d7ce7e5d4e5" } = {}) {
  const views: Box[][] = [];
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/workbench/v1/banks") return route.fulfill({ json: { plugin: fixture.meta.plugin, banks: [DRAYNOR] } });
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
      // Too many: only counted, as the service does. The fairy rings are one network, its hub near the Wizards' Tower ring.
      const listed = found.length <= fixture.meta.viewLimit ? found.map(t => t.construction === "paired" ? { ...t, network: RINGS.id } : t) : [];
      return route.fulfill({ json: { total: found.length, transports: listed, networks: listed.some(t => t.construction === "paired") ? [RINGS] : [] } });
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

/** Where a tile is drawn once the map has settled: the same pixel twice running. */
async function settledPixel(page: Page, point: Point) {
  const pixel = () => page.evaluate(p => (window as unknown as { insetMap: { pixel(p: Point): number[] | null } }).insetMap.pixel(p), point);
  let last: number[] | null = null;
  await expect.poll(async () => { const now = await pixel(); const settled = !!now && JSON.stringify(now) === JSON.stringify(last); last = now; return settled; },
    { intervals: [250] }).toBe(true);
  return last!;
}

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
  const [x, y] = await settledPixel(page, tile);
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

test("filters by type from the map's layer control, and keeps the filter in the URL", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3210,3214,0&z=9");
  const list = page.getByRole("navigation", { name: "Transports" });
  const layers = page.getByRole("group", { name: "Map layers" });
  await layers.getByText(/^Types/).click();
  await layers.getByRole("button", { name: "None" }).click();
  await expect(list.locator(".wb-list-heading")).toHaveText("0 in view");
  await expect.poll(async () => Object.values(await featureCount(page)).reduce((a, b) => a + b, 0)).toBe(0);
  await layers.getByRole("checkbox", { name: /Teleportation spell home/ }).check();
  await expect(page).toHaveURL(/types=TELEPORTATION_SPELL_HOME/);
  await expect(list.locator("ol button").first()).toContainText("Lumbridge Home Teleport");
  await expect(list.locator("ol button", { hasText: "Staircase" })).toHaveCount(0);
});

test("switches the transports off and the routing layers on, and keeps them in the URL", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3210,3214,0&z=9");
  const list = page.getByRole("navigation", { name: "Transports" });
  const layers = page.getByRole("group", { name: "Map layers" });
  await expect(layers.getByLabel("Transports", { exact: true })).toBeChecked();
  await expect(list.locator(".wb-list-heading")).toContainText(/in view/);
  await layers.getByLabel("Transports", { exact: true }).uncheck();
  await expect(list.locator(".wb-list-heading")).toHaveText("The transports layer is off.");
  await expect.poll(async () => Object.values(await featureCount(page)).reduce((a, b) => a + b, 0)).toBe(0);
  await layers.getByLabel("Synthetic separators", { exact: true }).check();
  await expect(page).toHaveURL(/layers=separators(&|$)/);
  await page.reload();
  await expect(page.getByRole("group", { name: "Map layers" }).getByLabel("Transports", { exact: true })).not.toBeChecked();
  await expect(page.getByRole("group", { name: "Map layers" }).getByLabel("Synthetic separators", { exact: true })).toBeChecked();
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

test("draws a network as spokes to its hub, which lists its stations", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3110,3152,0&z=10");
  await expect.poll(async () => (await featureCount(page)).hub).toBe(1);
  const [x, y] = await settledPixel(page, RINGS.hub);
  await page.locator(".inset-map").click({ position: { x, y } });
  const list = page.getByRole("navigation", { name: "Transports" });
  await expect(list.locator(".wb-list-heading")).toContainText("Fairy rings 3 stations");
  await list.getByRole("button", { name: /A L S/ }).click();
  await expect(list.locator(".wb-list-heading")).toContainText("At 2644 3495 0");
});

test("shows banks from the layer control, and a clicked bank's tiles and needs", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3092,3245,0&z=10&layers=banks");
  await expect.poll(async () => (await featureCount(page)).point).toBe(2);
  const [x, y] = await settledPixel(page, DRAYNOR.tiles[0]);
  await page.locator(".inset-map").click({ position: { x, y } });
  const detail = page.getByRole("region", { name: "Bank" });
  await expect(detail).toContainText("Draynor Village");
  await expect(detail).toContainText("3091 3243 0");
  await expect(detail.locator(".wb-chip.quest")).toHaveText("Some Quest");
  // Zoomed out, the layer says why it draws nothing.
  await open(page, "?at=3092,3245,0&z=6&layers=banks");
  await expect(page.locator(".layer-status")).toContainText("Zoom in to see banks");
});

test("switches transport families and network hubs from the layer control", async ({ page }) => {
  await mockCatalogue(page);
  await open(page, "?at=3110,3152,0&z=10");
  const layers = page.getByRole("group", { name: "Map layers" });
  await expect.poll(async () => (await featureCount(page)).hub).toBe(1);
  await layers.getByRole("checkbox", { name: "Network hubs" }).uncheck();
  await expect(page).toHaveURL(/hubs=0/);
  await expect.poll(async () => (await featureCount(page)).hub).toBe(0);
  // A family is every type of its colour at once.
  await layers.getByRole("checkbox", { name: "Teleports" }).uncheck();
  await expect(page).toHaveURL(/types=/);
  expect(new URL(page.url()).searchParams.get("types")!.split(",")).not.toContain("TELEPORTATION_SPELL_HOME");
  await layers.getByRole("checkbox", { name: "Teleports" }).check();
  await expect(page).not.toHaveURL(/types=/);
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

test("stays bounded over a dense network, and draws nothing zoomed out", async ({ page }) => {
  const views = await mockCatalogue(page, { dense: true });
  await open(page, "?at=3210,3214,0&z=9");
  const list = page.getByRole("navigation", { name: "Transports" });
  await expect(list.locator(".wb-list-heading")).toContainText(/[1-9]\d* in view/);
  await expect.poll(async () => (await featureCount(page)).edge).toBeGreaterThan(0);
  const close = await featureCount(page);
  // Each door is a single bar over the edge it crosses, not two tiles and an arrow.
  expect(close.point).toBe(0);
  expect(close.edge).toBeLessThanOrEqual(fixture.meta.viewLimit);
  expect(await list.locator("ol li").count()).toBeLessThanOrEqual(200);

  await open(page, "?at=3000,3300,0&z=5");
  await expect(list.locator(".wb-list-heading")).toContainText("Zoom in to see transports");
  await expect(page.locator(".layer-status")).toContainText("Zoom in to see transports");
  const asked = views.length;
  await page.waitForTimeout(500);
  const far = await featureCount(page);
  expect(far.edge + far.point + far.region).toBe(0);
  // Nothing is asked for that wouldn't be drawn.
  expect(views.length).toBe(asked);
});

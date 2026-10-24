import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import tiles from "../tiles.json" with { type: "json" };

test.use({ baseURL: "http://workbench.localhost:5179" });

// A snapshot of the pinned routing release: the squares these tests look at, with their original bytes.
const root = path.resolve(import.meta.dirname, "fixtures/routing");
const fixture = JSON.parse(readFileSync(path.join(root, "dungeon.json"), "utf8"));
const release = `${tiles.base}/routing-layers/${tiles.routingLayers.version}`;

type Point = { x: number; y: number; plane: number };
type InsetMapHandle = { showTile(p: Point): void; pixel(p: Point): number[]; fitRegions(ids: string[]): void };
const point = (p: number[]): Point => ({ x: p[0], y: p[1], plane: p[2] });

async function setup(page: Page) {
  // Offer Blueprint even while the published pin has two styles.
  await page.route(url => url.pathname === "/tiles.json", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('"tactical"', '"tactical", "blueprint"');
    await route.fulfill({ response, body });
  });
  await page.route(`${release}/**`, route => {
    const relative = new URL(route.request().url()).pathname.split(`/${tiles.routingLayers.version}/`)[1];
    const file = path.join(root, relative);
    if (!existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ body: readFileSync(file), contentType: relative.endsWith(".json") ? "application/json" : "application/octet-stream" });
  });
  await page.route(url => url.pathname.startsWith("/api/"), route => route.fulfill({ status: 404, json: { error: "No service fixture" } }));
  await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style", "tactical"));
}

const insetMap = (page: Page) => page.evaluate(() => !!(window as unknown as { insetMap?: unknown }).insetMap);

async function at(page: Page, p: Point) {
  await page.evaluate(p => (window as unknown as { insetMap: InsetMapHandle }).insetMap.showTile(p), p);
  await page.waitForTimeout(350);
}

async function pixel(page: Page, p: Point) {
  return page.evaluate(p => (window as unknown as { insetMap: InsetMapHandle }).insetMap.pixel(p), p);
}

async function click(page: Page, p: Point) {
  await at(page, p);
  const [x, y] = await pixel(page, p), box = (await page.locator(".inset-map").boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

/** The routing canvas's RGBA where a tile is drawn. */
async function colour(page: Page, p: Point) {
  return page.evaluate(p => {
    const [x, y] = (window as unknown as { insetMap: InsetMapHandle }).insetMap.pixel(p);
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-routing-layer]")!;
    const ratio = canvas.width / parseFloat(canvas.style.width);
    return [...canvas.getContext("2d")!.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data];
  }, p);
}
const alpha = async (page: Page, p: Point) => (await colour(page, p))[3];

async function openDungeon(page: Page) {
  await setup(page);
  await page.goto(`/insets?area=area:taverley-dungeon&region=${fixture.region.id}&at=2893,9792,0&z=10`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await expect.poll(() => insetMap(page)).toBe(true);
}

test("real dungeon partitions and negative terrain survive styles, inset dragging, clipping and floor changes", async ({ page }) => {
  await openDungeon(page);
  const squares: string[] = [];
  page.on("request", request => { if (request.url().endsWith(".bin") && request.url().includes("routing-layers")) squares.push(request.url()); });

  await page.getByLabel("Routing components", { exact: true }).check();
  const retained = point(fixture.samples.component761), negative = point(fixture.samples.unreachable);
  await click(page, retained);
  await expect(page.getByLabel("Production routing component", { exact: true })).toContainText("761");

  // Toggling a layer keeps the map instance.
  await page.evaluate(() => { const w = window as unknown as { routingHandle: unknown; insetMap: unknown }; w.routingHandle = w.insetMap; });
  await page.getByLabel("Structurally unreachable", { exact: true }).check();
  expect(await page.evaluate(() => { const w = window as unknown as { routingHandle: unknown; insetMap: unknown }; return w.routingHandle === w.insetMap; })).toBe(true);

  await click(page, negative);
  await expect(page.getByLabel("Routing tile status")).toContainText("Structurally unreachable walking terrain");
  await expect(page.getByLabel("Routing tile status")).toContainText("outside the retained production search graph");
  await expect.poll(() => alpha(page, negative)).toBeGreaterThan(0);
  await page.getByLabel("Minimum unreachable fragment tiles").fill("100000000");
  await expect.poll(() => alpha(page, negative)).toBe(0);
  await page.getByLabel("Minimum unreachable fragment tiles").fill("0");
  await expect.poll(() => alpha(page, negative)).toBeGreaterThan(0);

  // Nothing is drawn outside the region's own terrain.
  await at(page, point(fixture.clipped));
  await expect.poll(() => alpha(page, point(fixture.clipped))).toBe(0);

  for (const style of ["Standard", "Blueprint"]) {
    await at(page, negative);
    await page.getByRole("button", { name: style, exact: true }).click();
    await expect.poll(() => alpha(page, negative)).toBeGreaterThan(0);
  }
  await page.getByRole("button", { name: "Tactical", exact: true }).click();
  await page.getByRole("button", { name: "Beside entrance", exact: true }).click();
  await at(page, negative);
  await expect.poll(() => alpha(page, negative)).toBeGreaterThan(0);

  // Dragging the inset moves the overlay with it.
  await page.evaluate(id => (window as unknown as { insetMap: InsetMapHandle }).insetMap.fitRegions([id]), fixture.region.id);
  await page.waitForTimeout(350);
  const header = page.locator(".inset-label").filter({ hasText: "Taverley" }).first();
  const before = await pixel(page, negative), bounds = (await header.boundingBox())!;
  const grab = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 70, grab.y + 45, { steps: 5 });
  await page.mouse.up();
  const after = await pixel(page, negative);
  expect(after[0] - before[0]).toBeCloseTo(70, 0);
  expect(after[1] - before[1]).toBeCloseTo(45, 0);
  await expect.poll(() => alpha(page, negative)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Plane 1", exact: true }).click();
  await expect(page.locator(".inset-label").filter({ hasText: "Plane 1" }).first()).toBeVisible();
  const upper = point(fixture.upper.point);
  await click(page, upper);
  await expect(page.getByLabel("Routing tile status")).toContainText(`production routing component ${fixture.upper.component}`);
  // Selecting the new floor removes the old inspected floor from the layout.
  await at(page, upper);
  await expect.poll(() => alpha(page, upper)).toBeGreaterThan(0);
  expect(new Set(squares).size).toBe(squares.length);
});

test("selects the exact production diagonal crossing as an internal edge", async ({ page }) => {
  await setup(page);
  const crossing = fixture.surfaceCrossing, from = point(crossing.from), to = point(crossing.to);
  await page.goto(`/insets?at=${from.x},${from.y},0&z=11`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await page.getByLabel("Synthetic separators", { exact: true }).check();
  await expect(page.locator("canvas[data-routing-layer]")).toBeVisible();
  await expect.poll(() => alpha(page, from)).toBeGreaterThan(0);
  const a = await pixel(page, from), b = await pixel(page, to), box = (await page.locator(".inset-map").boundingBox())!;
  await page.mouse.click(box.x + (a[0] + b[0]) / 2, box.y + (a[1] + b[1]) / 2);
  const details = page.getByLabel("Synthetic crossing details");
  await expect(details).toContainText("Internal routing crossing 1");
  await expect(details).toContainText("3282 2904 0 → 3283 2905 0");
  await expect(details).toContainText("cost 1");
});

test("never draws a sea, and says it is an open expanse", async ({ page }) => {
  await setup(page);
  const sea = point(fixture.sea);
  await page.goto(`/insets?at=${sea.x},${sea.y},0&z=10`);
  await expect.poll(() => insetMap(page)).toBe(true);
  await page.getByLabel("Structurally unreachable", { exact: true }).check();
  await click(page, sea);
  await expect(page.getByLabel("Routing tile status")).toContainText("Open expanse");
  await expect.poll(() => alpha(page, sea)).toBe(0);
});

test("colours components from the release's tiles when zoomed out, without fetching a square", async ({ page }) => {
  await setup(page);
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("routing-layers")) requests.push(new URL(request.url()).pathname); });
  await page.goto(`/insets?area=area:taverley-dungeon&region=${fixture.region.id}&at=2893,9792,0&z=6`);
  await expect.poll(() => insetMap(page)).toBe(true);
  await page.getByLabel("Routing components", { exact: true }).check();
  const retained = point(fixture.samples.component761);
  const components = JSON.parse(readFileSync(path.join(root, "components.json"), "utf8")) as { id: number; colour: number }[];
  const palette = (JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { componentPalette: string[] }).componentPalette;
  const hex = palette[components.find(c => c.id === 761)!.colour];
  const expected = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  // The tint canvas holds the palette colour itself; the page blends it into the terrain.
  await expect.poll(async () => (await page.evaluate(([x, y]) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-routing-tints]")!;
    const ratio = canvas.width / parseFloat(canvas.style.width);
    return [...canvas.getContext("2d")!.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data];
  }, await pixel(page, retained))).slice(0, 3)).toEqual(expected);
  expect(requests.some(request => request.endsWith(".png"))).toBe(true);
  expect(requests.filter(request => request.endsWith(".bin"))).toEqual([]);
});

for (const field of ["collisionContentSha256", "transportSha256", "separatorSha256"]) {
  test(`rejects mismatched ${field} before requesting spatial data`, async ({ page }) => {
    await setup(page);
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    manifest[field] = "0".repeat(64);
    await page.route(`${release}/manifest.json`, route => route.fulfill({ json: manifest }));
    const squares: string[] = [];
    page.on("request", request => { if (request.url().includes("routing-layers") && request.url().endsWith(".bin")) squares.push(request.url()); });
    await page.goto("/insets");
    await page.getByLabel("Routing components", { exact: true }).check();
    await expect(page.getByRole("alert")).toContainText("Routing layers do not match");
    expect(squares).toEqual([]);
  });
}

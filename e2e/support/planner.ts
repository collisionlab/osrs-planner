import { expect, test as base, type Locator, type Page } from "@playwright/test";
import type { WorldPoint } from "../../src/domain/contracts";
import { mockApi, type RouteCall } from "./api";

/** A test with the route API mocked; `api` lists the route requests the page made. */
export const test = base.extend<{ api: RouteCall[] }>({
  // Automatic, so no test reaches a real route service, even one that never names `api`.
  api: [async ({ page }, use) => {
    const calls = await mockApi(page);
    await page.route("**/version", route => route.fulfill({ json: { release: "e2e" } }));
    // The tactical style, so map tiles come from the pinned collisionlab release.
    await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style", "tactical"));
    await use(calls);
  }, { auto: true }],
});
export { expect };

/** Opens the planner at `query` and waits for the inset map and its terrain. */
export async function openInsets(page: Page, query: string) {
  await page.goto(`/route?insets=1&${query}`);
  await expect(page.locator(".inset-map")).toBeVisible();
  await expect(page.locator(".map-message[role=status]")).toHaveCount(0);
  await page.waitForFunction(() => Boolean((window as unknown as { insetMap?: unknown }).insetMap));
  await page.waitForLoadState("networkidle");
}

/** The page position where the inset map draws a world tile. */
export async function tile(page: Page, point: WorldPoint) {
  const map = await page.locator(".inset-map").boundingBox();
  const pixel = await page.evaluate(p => (window as unknown as { insetMap: { pixel(p: WorldPoint): number[] } }).insetMap.pixel(p), point);
  return { x: map!.x + pixel[0], y: map!.y + pixel[1] };
}

export const point = (x: number, y: number, plane = 0): WorldPoint => ({ x, y, plane });

/** Whether two elements' boxes overlap. */
export async function overlap(a: Locator, b: Locator) {
  const [p, q] = [await a.boundingBox(), await b.boundingBox()];
  return Boolean(p && q && p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height);
}

import { expect, openInsets, overlap, point, test, tile } from "./support/planner";

test("opens a building's floors from its staircase and plans up to the bank floor", async ({ page, api }) => {
  await openInsets(page, "account=early&from=lumbridge");
  const stairs = await tile(page, point(3205, 3209));
  await page.mouse.click(stairs.x, stairs.y);
  await expect(page.locator(".inset-label", { hasText: "Plane 1" })).toBeVisible();
  await expect(page.locator(".inset-label", { hasText: "Plane 2" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Shown areas" })).toContainText("Floors by 3205, 3209");

  const bank = await tile(page, point(3209, 3218, 2));
  await page.mouse.click(bank.x, bank.y);
  await expect(page).toHaveURL(/to=3209%2C3218%2C2/);
  await expect.poll(() => api.at(-1)?.scenario).toBe("lumbridge-castle-bank");
  await expect(page.locator(".segments")).toContainText("Climb-up Staircase");
});

test("stacks the upper floors a glider route climbs, with labels that never overlap", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=2465,3501,0");
  await expectNoOverlappingLabels(page);
  // Zoomed in on the ladders, every floor is big enough to name.
  await page.locator(".segment-button", { hasText: "Climb-down Ladder 2884" }).click();
  for (const plane of [1, 2, 3]) {
    await expect(page.locator(".inset-label", { hasText: new RegExp(`^Plane ${plane}$`) })).toBeVisible();
  }
  await expectNoOverlappingLabels(page);
});

async function expectNoOverlappingLabels(page: import("@playwright/test").Page) {
  await page.waitForTimeout(300); // the labels settle a frame after the map draws
  const labels = await page.locator(".inset-label").filter({ visible: true }).all();
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) expect(await overlap(labels[i], labels[j])).toBe(false);
  }
}

test("keeps a walk on an upper floor inside that floor's inset", async ({ page }) => {
  // The Grand Tree's first floor is only its trunk room; the walk out to Daero runs along branches.
  await openInsets(page, "account=mid&from=2462,3482,0&to=2484,3486,1");
  const upstairs = await tile(page, point(2484, 3486, 1));
  const ground = await tile(page, point(2484, 3486, 0));
  expect(Math.hypot(upstairs.x - ground.x, upstairs.y - ground.y)).toBeGreaterThan(20);
});

test("shows an underground area picked in the search", async ({ page }) => {
  await openInsets(page, "account=mid");
  const search = page.getByRole("combobox", { name: "Show an underground or instanced area" });
  await search.fill("Chasm of Fire");
  await search.press("Enter");
  await expect(page.getByRole("list", { name: "Shown areas" })).toContainText("Chasm of Fire");
  await expect(page.locator(".inset-label", { hasText: "Chasm of Fire" }).first()).toBeVisible();
});

test("switches a shown area between its planes", async ({ page }) => {
  await openInsets(page, "account=mid");
  const search = page.getByRole("combobox", { name: "Show an underground or instanced area" });
  await search.fill("Chasm of Fire");
  await search.press("Enter");
  const planes = page.getByRole("group", { name: "Chasm of Fire: plane" });
  await expect(planes.getByRole("button")).toHaveText(["0", "1", "2"]);
  await expect(planes.getByRole("button", { name: "0" })).toHaveAttribute("aria-pressed", "true");
  await planes.getByRole("button", { name: "2" }).click();
  await expect(page.locator(".inset-label", { hasText: "Chasm of Fire · Plane 2" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Chasm of Fire: plane" }).getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
});

test("marks a teleport's landing tile", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=3300,3245,0");
  await expect(page.locator(".inset-endpoint.landing")).toHaveCount(1);
});

test("plans routes while an endpoint is dragged and keeps the view after", async ({ page, api }) => {
  await openInsets(page, "account=mid&from=lumbridge&to=varrock");
  const start = await tile(page, point(3210, 3424));
  const before = await tile(page, point(3222, 3218));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + 60, { steps: 20 });
  await expect.poll(() => api.filter(call => call.trigger === "drag").length).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page).not.toHaveURL(/to=varrock/);
  // The map stays where it was rather than fitting the new route.
  const after = await tile(page, point(3222, 3218));
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(2);
});

test("cuts insets from the Standard tiles when Standard is chosen", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("osrs-planner.map-style", "standard"));
  const native: string[] = [];
  page.on("request", request => { if (/\/8\/\d+\/\d+\.png$/.test(request.url())) native.push(request.url()); });
  await openInsets(page, "account=mid");
  const search = page.getByRole("combobox", { name: "Show an underground or instanced area" });
  await search.fill("Chasm of Fire");
  await search.press("Enter");
  await expect(page.locator(".inset-label", { hasText: "Chasm of Fire" }).first()).toBeVisible();
  await expect.poll(() => native.filter(url => url.includes("/standard/")).length).toBeGreaterThan(0);
  expect(native.filter(url => url.includes("/tactical/"))).toEqual([]);
});

import { expect, test } from "./support/planner";

test("routes follow account edits before they are saved", async ({ page, api }) => {
  await page.goto("/route?account=mid&from=lumbridge&to=varrock");
  await expect(page.locator(".segments")).toBeVisible();
  await page.getByRole("button", { name: /Account/ }).click();
  await page.getByLabel("Agility", { exact: true }).fill("99");
  await expect.poll(() => api.at(-1)?.body.account.levels.AGILITY).toBe(99);
  await expect(page.locator(".account-toggle")).toContainText("edited");
});

test("keeps one respawn point, and unreported unlocks belong to the account", async ({ page }) => {
  await page.goto("/route?account=early");
  await page.getByRole("button", { name: /Account/ }).click();
  await page.locator("summary", { hasText: "Unlocks" }).click();
  const respawn = page.getByLabel("Respawn point");
  await expect(respawn.locator("option")).toContainText(["Lumbridge", "Falador", "Prifddinas"]);
  await respawn.selectOption({ label: "Prifddinas" });
  await page.getByLabel("Axe stored at a canoe station").check();
  await expect(respawn).toHaveValue("RESPAWN_PRIFDDINAS");
  // Travel options no longer hold account facts.
  await page.locator(".travel-policy > summary").click();
  await expect(page.locator(".route-options")).not.toContainText("Axe stored");
});

test("finds a typed coordinate in the place search", async ({ page }) => {
  await page.goto("/route?account=mid");
  const from = page.getByRole("combobox").first();
  await from.fill("3222 3218 2");
  await expect(page.getByRole("option", { name: /Tile 3222, 3218, plane 2/ })).toBeVisible();
  await from.press("Enter");
  await expect(page).toHaveURL(/from=3222%2C3218%2C2/);
});

test("selects a leg by clicking it, not by pointing at it", async ({ page }) => {
  await page.goto("/route?account=mid&from=lumbridge&to=varrock");
  const leg = page.locator(".segment-button").first();
  await leg.hover();
  await expect(leg).toHaveAttribute("aria-pressed", "false");
  await leg.click();
  await expect(leg).toHaveAttribute("aria-pressed", "true");
});

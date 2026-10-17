import { expect, openInsets, test } from "./support/planner";

// Whole-map pictures of scenes that have regressed before. Update them on purpose with
// `npm run e2e -- --update-snapshots` and review the new images.
test("glider route with stacked upper floors", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=2465,3501,0");
  await expect(page.locator(".inset-map")).toHaveScreenshot("glider-upper-floors.png");
});

test("Lumbridge Castle bank route", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=3209,3218,2");
  await expect(page.locator(".inset-map")).toHaveScreenshot("lumbridge-castle-bank.png");
});

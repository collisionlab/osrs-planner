import { expect, openInsets, test } from "./support/planner";

// Which styles a release offers isn't what these pictures are about, and a mask would still follow the
// toggle's width: hide it.
const unrelated = { stylePath: "e2e/visual-hide.css" };

// Whole-map pictures of scenes that have regressed before. Update them on purpose with
// `npm run e2e -- --update-snapshots` and review the new images. Snapshots must come from CI (its
// font rendering differs slightly from a local run): take them from the failed run's report.
test("glider route with stacked upper floors", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=2465,3501,0");
  await expect(page.locator(".inset-map")).toHaveScreenshot("glider-upper-floors.png", unrelated);
});

test("Lumbridge Castle bank route", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=3209,3218,2");
  await expect(page.locator(".inset-map")).toHaveScreenshot("lumbridge-castle-bank.png", unrelated);
});

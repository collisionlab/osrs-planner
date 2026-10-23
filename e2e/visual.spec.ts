import type { Page } from "@playwright/test";
import { expect, openInsets, test } from "./support/planner";

const unrelated = (page: Page) => ({ mask: [page.getByRole("group", { name: "Map style" })] });

// Whole-map pictures of scenes that have regressed before. Update them on purpose with
// `npm run e2e -- --update-snapshots` and review the new images. The map-style toggle is masked: which
// styles a tiles release offers is not what these pictures are about.
test("glider route with stacked upper floors", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=2465,3501,0");
  await expect(page.locator(".inset-map")).toHaveScreenshot("glider-upper-floors.png", unrelated(page));
});

test("Lumbridge Castle bank route", async ({ page }) => {
  await openInsets(page, "account=early&from=lumbridge&to=3209,3218,2");
  await expect(page.locator(".inset-map")).toHaveScreenshot("lumbridge-castle-bank.png", unrelated(page));
});

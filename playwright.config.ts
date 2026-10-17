import { defineConfig } from "@playwright/test";

// End-to-end tests of the planner UI (e2e/). The route API is mocked from recorded fixtures; map
// tiles and inset assets come from tiles.collisionlab.world at the versions tiles.json pins, which
// never change. Browsers come from the Nix dev shell: run `nix develop -c npm run e2e`.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixels: 200 } },
  snapshotPathTemplate: "e2e/snapshots/{testFilePath}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:5179",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    // The proxy points at a port nothing listens on, so an unmocked API call fails here as in CI.
    command: "npx vite --host 127.0.0.1 --port 5179 --strictPort",
    env: { VITE_API_PROXY: "http://127.0.0.1:9" },
    url: "http://127.0.0.1:5179/route",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

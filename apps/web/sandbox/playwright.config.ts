import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../../test-results/sandbox",
  workers: process.env.CI === "true" ? 4 : 1,
  // The same assertion budget as the production suite: the bundle renders
  // whole projections at once, and four workers share one CI runner.
  expect: { timeout: 10_000 },
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});

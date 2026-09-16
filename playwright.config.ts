import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://chronelle:chronelle_dev@localhost:5432/chronelle";
const isCi = process.env.CI === "true";

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "webkit-desktop",
      testMatch:
        /(event-accessibility|date-formatting|editor-feedback|editor-submit|appearance|page-navigation|workspace-utilities|collection-return|first-use|workspace-commands|component-shortcuts|context-commands|command-search|event-arrange|component-catalog|page-presets|event-drafts|schedule-refinement|event-inspector|event-draft-recovery|schedule-inspector|schedule-creation|schedule-draft-recovery|task-editors|object-draft-recovery|expenses|history|row-order|quick-add|component-views)\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "webkit-mobile",
      testMatch:
        /(event-accessibility|date-formatting|editor-feedback|editor-submit|appearance|page-navigation|workspace-utilities|collection-return|first-use|workspace-commands|component-shortcuts|context-commands|command-search|event-arrange|component-catalog|page-presets|event-drafts|schedule-refinement|event-inspector|event-draft-recovery|schedule-inspector|schedule-creation|schedule-draft-recovery|task-editors|object-draft-recovery|expenses|history|row-order|quick-add|component-views)\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  reporter: isCi ? "github" : "list",
  retries: isCi ? 1 : 0,
  testDir: "./apps/web/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @chronelle/api start",
      env: {
        API_HOST: "127.0.0.1",
        API_PORT: "4000",
        DATABASE_URL: databaseUrl,
        DOCUMENT_TRANSFER_TTL_SECONDS: "60",
        ENABLE_DEVELOPMENT_AUTH: "true",
        LOCAL_STORAGE_ROOT: ".chronelle/e2e-storage",
      },
      reuseExistingServer: !isCi,
      timeout: 60_000,
      url: "http://127.0.0.1:4000/api/health",
    },
    {
      command: "pnpm --filter @chronelle/web start",
      env: {
        API_INTERNAL_URL: "http://127.0.0.1:4000",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
        WEB_DEVELOPMENT_SIGN_IN: "true",
      },
      reuseExistingServer: !isCi,
      timeout: 60_000,
      url: "http://127.0.0.1:3000/sign-in",
    },
  ],
  workers: isCi ? 4 : 1,
});

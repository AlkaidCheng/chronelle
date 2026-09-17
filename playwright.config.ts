import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://chronelle:chronelle_dev@localhost:5432/chronelle";
const isCi = process.env.CI === "true";
/** `E2E_SHARD=current/total` runs one slice of the suite, one runner each in CI. */
const shard = (() => {
  const match = /^(\d+)\/(\d+)$/u.exec(process.env.E2E_SHARD ?? "");
  return match
    ? { current: Number(match[1]), total: Number(match[2]) }
    : undefined;
})();

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
      grep: /@webkit-desktop/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "webkit-mobile",
      grep: /@webkit-mobile/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  // CI keeps the annotations and lists every test's duration for tuning.
  reporter: isCi ? [["github"], ["list"]] : "list",
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
  ...(shard === undefined ? {} : { shard }),
  // A CI runner has four vCPUs shared with both servers and PostgreSQL; two
  // browsers keep them busy without starving one another.
  workers: isCi ? 2 : 1,
});

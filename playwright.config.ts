import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://chronelle:chronelle_dev@localhost:5432/chronelle";
const isCi = process.env.CI === "true";
/**
 * `E2E_WEB_PORT` and `E2E_API_PORT` move the journeys' servers off 3000 and
 * 4000, so they can run beside a local deployment that holds those ports.
 */
const webPort = process.env.E2E_WEB_PORT ?? "3000";
const apiPort = process.env.E2E_API_PORT ?? "4000";
/**
 * `E2E_PROJECT=name` runs one browser project, one runner each in CI: a WebKit
 * journey costs almost twice a Chromium one, so slicing by project balances
 * the runners better than slicing the list by count.
 */
const onlyProject = process.env.E2E_PROJECT;

const allProjects = [
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
];

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "test-results/playwright",
  projects: allProjects.filter(
    (project) => onlyProject === undefined || project.name === onlyProject,
  ),
  // CI keeps the annotations and lists every test's duration for tuning.
  reporter: isCi ? [["github"], ["list"]] : "list",
  retries: isCi ? 1 : 0,
  testDir: "./apps/web/e2e",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @livtales/api start",
      env: {
        API_HOST: "127.0.0.1",
        API_PORT: apiPort,
        DATABASE_URL: databaseUrl,
        DOCUMENT_TRANSFER_TTL_SECONDS: "60",
        // The account journeys read the emailed codes from this mailbox
        // file (`apps/web/e2e/helpers/mailbox.ts`); the path is relative to
        // the API package, where the script runs.
        EMAIL_FILE_PATH: ".livtales/e2e-emails.jsonl",
        EMAIL_PROVIDER: "file",
        ENABLE_DEVELOPMENT_AUTH: "true",
        LOCAL_STORAGE_ROOT: ".livtales/e2e-storage",
      },
      reuseExistingServer: !isCi,
      timeout: 60_000,
      url: `http://127.0.0.1:${apiPort}/api/health`,
    },
    {
      command: "pnpm --filter @livtales/web start",
      env: {
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
        HOSTNAME: "127.0.0.1",
        PORT: webPort,
        WEB_DEVELOPMENT_SIGN_IN: "true",
      },
      reuseExistingServer: !isCi,
      timeout: 60_000,
      url: `http://127.0.0.1:${webPort}/sign-in`,
    },
  ],
  // A CI runner has four vCPUs shared with both servers and PostgreSQL; two
  // browsers keep them busy without starving one another.
  workers: isCi ? 2 : 1,
});

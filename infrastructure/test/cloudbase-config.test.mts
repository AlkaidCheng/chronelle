import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const harness = resolve(
  import.meta.dirname,
  "../scripts/cloudbase-read-contract.mjs",
);
const fixtureEnvironment = {
  CLOUDBASE_ENV_ID: "staging-env",
  CLOUDBASE_APIKEY: "opaque-key",
  CLOUDBASE_CONTRACT_WORKSPACE_ID: "workspace",
  CLOUDBASE_CONTRACT_USER_ID: "user",
  CLOUDBASE_CONTRACT_EVENT_ID: "event",
};

function runHarness(overrides: Record<string, string>) {
  const result = spawnSync(process.execPath, [harness], {
    encoding: "utf8",
    env: { ...process.env, ...fixtureEnvironment, ...overrides },
  });
  return { status: result.status, stderr: result.stderr };
}

describe("CloudBase read-contract configuration", () => {
  it("rejects a page limit outside the event-list schema before any request", () => {
    for (const value of ["0", "51", "two", "2.5"]) {
      const { status, stderr } = runHarness({
        CLOUDBASE_CONTRACT_PAGE_LIMIT: value,
      });
      expect(status).toBe(2);
      expect(stderr).toContain("CLOUDBASE_CONTRACT_PAGE_LIMIT");
    }
  });

  it("rejects a request timeout outside the documented range", () => {
    const { status, stderr } = runHarness({
      CLOUDBASE_REQUEST_TIMEOUT_MS: "999",
    });
    expect(status).toBe(2);
    expect(stderr).toContain("CLOUDBASE_REQUEST_TIMEOUT_MS");
  });
});

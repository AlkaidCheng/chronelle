import { describe, expect, it } from "vitest";

import {
  backendEnvironmentSchema,
  cloudBaseRequiredFunctions,
  gatewayEventLevel,
  resolveBackend,
} from "../src/backend-mode.js";

const parse = (environment: Record<string, string>) =>
  resolveBackend(backendEnvironmentSchema.parse(environment));

describe("resolveBackend", () => {
  it("defaults to PostgreSQL with the CloudBase flags off", () => {
    expect(parse({ DATABASE_URL: "postgresql://db/chronelle" })).toEqual({
      backend: "postgres",
      databaseUrl: "postgresql://db/chronelle",
      cloudBaseReads: false,
      cloudBaseWrites: false,
    });
  });

  it("requires DATABASE_URL for PostgreSQL and reads before writes", () => {
    expect(() => parse({})).toThrow("DATABASE_URL is required");
    expect(() =>
      parse({
        DATABASE_URL: "postgresql://db/chronelle",
        CLOUDBASE_WRITES_ENABLED: "true",
      }),
    ).toThrow("requires CLOUDBASE_READS_ENABLED=true");
    expect(
      parse({
        DATABASE_URL: "postgresql://db/chronelle",
        CLOUDBASE_READS_ENABLED: "true",
        CLOUDBASE_WRITES_ENABLED: "true",
      }),
    ).toMatchObject({ backend: "postgres", cloudBaseWrites: true });
  });

  it("serves everything from the gateway in the CloudBase backend without DATABASE_URL", () => {
    expect(parse({ CHRONELLE_BACKEND: "cloudbase" })).toEqual({
      backend: "cloudbase",
      databaseUrl: undefined,
      cloudBaseReads: true,
      cloudBaseWrites: true,
    });
    expect(() =>
      parse({
        CHRONELLE_BACKEND: "cloudbase",
        CLOUDBASE_WRITES_ENABLED: "false",
      }),
    ).toThrow(
      "CHRONELLE_BACKEND=cloudbase requires CLOUDBASE_WRITES_ENABLED=true",
    );
  });

  it("verifies the identity function alongside the object-model functions", () => {
    expect(cloudBaseRequiredFunctions).toContain("chronelle_identity_sign_in");
    expect(cloudBaseRequiredFunctions).toEqual(
      expect.arrayContaining([
        "chronelle_session_create",
        "chronelle_session_resolve",
        "chronelle_session_revoke",
        "chronelle_sessions_revoke_all",
      ]),
    );
    expect(cloudBaseRequiredFunctions).toContain("chronelle_backend_readiness");
  });

  it("logs routine rejections as information and failures as errors", () => {
    const base = { kind: "rpc" as const, target: "f", durationMs: 1 };
    expect(gatewayEventLevel({ ...base, outcome: "ok" })).toBe("debug");
    expect(
      gatewayEventLevel({ ...base, outcome: "rejected", status: 409 }),
    ).toBe("info");
    expect(
      gatewayEventLevel({ ...base, outcome: "rejected", status: 502 }),
    ).toBe("error");
    expect(gatewayEventLevel({ ...base, outcome: "timeout" })).toBe("error");
  });
});

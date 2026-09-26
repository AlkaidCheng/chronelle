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
    expect(parse({ LIVTALES_BACKEND: "cloudbase" })).toEqual({
      backend: "cloudbase",
      databaseUrl: undefined,
      cloudBaseReads: true,
      cloudBaseWrites: true,
    });
    expect(() =>
      parse({
        LIVTALES_BACKEND: "cloudbase",
        CLOUDBASE_WRITES_ENABLED: "false",
      }),
    ).toThrow(
      "LIVTALES_BACKEND=cloudbase requires CLOUDBASE_WRITES_ENABLED=true",
    );
  });

  it("refuses the legacy CHRONELLE_BACKEND unless LIVTALES_BACKEND matches it", () => {
    expect(() => parse({ CHRONELLE_BACKEND: "cloudbase" })).toThrow(
      "CHRONELLE_BACKEND was renamed to LIVTALES_BACKEND. Set LIVTALES_BACKEND instead.",
    );
    expect(() =>
      parse({
        CHRONELLE_BACKEND: "postgres",
        DATABASE_URL: "postgresql://db/chronelle",
      }),
    ).toThrow("Set LIVTALES_BACKEND instead.");
    expect(() =>
      parse({
        CHRONELLE_BACKEND: "cloudbase",
        LIVTALES_BACKEND: "postgres",
        DATABASE_URL: "postgresql://db/chronelle",
      }),
    ).toThrow("set to different values. Remove CHRONELLE_BACKEND.");
    expect(
      parse({ CHRONELLE_BACKEND: "cloudbase", LIVTALES_BACKEND: "cloudbase" }),
    ).toMatchObject({ backend: "cloudbase" });
  });

  it("verifies the identity function alongside the object-model functions", () => {
    expect(cloudBaseRequiredFunctions).toContain("chronelle_identity_sign_in");
    expect(cloudBaseRequiredFunctions).toContain(
      "chronelle_identity_session_resolve",
    );
    expect(cloudBaseRequiredFunctions).toEqual(
      expect.arrayContaining([
        "chronelle_session_create",
        "chronelle_session_resolve",
        "chronelle_session_revoke",
        "chronelle_sessions_revoke_all",
        "chronelle_password_credential_create",
        "chronelle_password_credential_lookup",
        "chronelle_password_attempt_record",
        "chronelle_email_verified",
        "chronelle_password_hash_update",
        "chronelle_verification_issue",
        "chronelle_verification_consume",
        "chronelle_friend_list",
        "chronelle_friend_invite",
        "chronelle_friend_request",
        "chronelle_friend_respond",
        "chronelle_friend_withdraw",
        "chronelle_friend_remove",
        "chronelle_friend_resend",
        "chronelle_friend_invitations_claim",
        "chronelle_person_shares_list",
        "chronelle_username_available",
        "chronelle_account_update",
        "chronelle_users_search",
        "chronelle_user_lookup",
      ]),
    );
    expect(cloudBaseRequiredFunctions).toContain("chronelle_backend_readiness");
    // Moving an Event to another space needs migration 0077.
    expect(cloudBaseRequiredFunctions).toEqual(
      expect.arrayContaining([
        "chronelle_object_move_targets",
        "chronelle_object_move_preview",
        "chronelle_object_move",
      ]),
    );
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

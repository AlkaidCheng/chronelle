import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "../src/runtime/config";

describe("Mini Program runtime configuration", () => {
  it("accepts an HTTPS deployment and explicit wx-cloud mode", () => {
    expect(
      parseRuntimeConfig({
        apiBaseUrl: "https://api.chronelle.example/",
        cloudBaseEnvId: "chronelle-staging-a1b2c3",
        useWxCloud: "true",
      }),
    ).toEqual({
      ok: true,
      value: {
        apiBaseUrl: "https://api.chronelle.example",
        cloudBaseEnvId: "chronelle-staging-a1b2c3",
        useWxCloud: true,
      },
    });
  });

  it("allows cleartext only for loopback development", () => {
    expect(
      parseRuntimeConfig({
        apiBaseUrl: "http://127.0.0.1:4000",
        cloudBaseEnvId: "chronelle-local",
      }).ok,
    ).toBe(true);
    expect(
      parseRuntimeConfig({
        apiBaseUrl: "http://api.example.test",
        cloudBaseEnvId: "chronelle-staging",
      }),
    ).toEqual({ ok: false, reason: "invalid-api-origin" });
  });

  it("rejects missing, credential-bearing, and malformed values", () => {
    expect(parseRuntimeConfig({})).toEqual({
      ok: false,
      reason: "missing-api-origin",
    });
    expect(
      parseRuntimeConfig({
        apiBaseUrl: "https://user:secret@example.test",
        cloudBaseEnvId: "chronelle-staging",
      }),
    ).toEqual({ ok: false, reason: "invalid-api-origin" });
    expect(
      parseRuntimeConfig({
        apiBaseUrl: "https://api.example.test",
        cloudBaseEnvId: "bad env",
      }),
    ).toEqual({ ok: false, reason: "invalid-cloudbase-environment" });
  });
});

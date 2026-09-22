import { describe, expect, it } from "vitest";

import {
  developmentSignInRequestSchema,
  developmentSignInResponseSchema,
  sessionResponseSchema,
  weChatCredentialRequestSchema,
  weChatIdentityLinkResponseSchema,
} from "../src/authentication.js";

describe("authentication schemas", () => {
  it("normalizes development email identities", () => {
    expect(
      developmentSignInRequestSchema.parse({
        displayName: "  Alex Example  ",
        email: "ALEX@EXAMPLE.COM",
      }),
    ).toEqual({
      displayName: "Alex Example",
      email: "alex@example.com",
    });
  });

  it("rejects malformed session payloads", () => {
    expect(
      developmentSignInResponseSchema.safeParse({
        accessToken: "token",
        tokenType: "Basic",
        expiresAt: "tomorrow",
      }).success,
    ).toBe(false);
    expect(
      sessionResponseSchema.safeParse({
        principal: {
          type: "user",
          userId: "not-a-uuid",
          workspaceId: "not-a-uuid",
        },
      }).success,
    ).toBe(false);
  });

  it("bounds CloudBase credentials without accepting extra fields", () => {
    expect(
      weChatCredentialRequestSchema.parse({
        accessToken: "x".repeat(20),
        deviceId: "device-1",
      }),
    ).toEqual({ accessToken: "x".repeat(20), deviceId: "device-1" });
    expect(
      weChatCredentialRequestSchema.safeParse({ accessToken: "short" }).success,
    ).toBe(false);
    expect(
      weChatCredentialRequestSchema.safeParse({
        accessToken: "x".repeat(4_097),
      }).success,
    ).toBe(false);
    expect(
      weChatCredentialRequestSchema.safeParse({
        accessToken: "x".repeat(20),
        deviceId: "contains spaces",
      }).success,
    ).toBe(false);
    expect(
      weChatCredentialRequestSchema.safeParse({
        accessToken: "x".repeat(20),
        profile: {},
      }).success,
    ).toBe(false);
    expect(weChatIdentityLinkResponseSchema.parse({ linked: true })).toEqual({
      linked: true,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  developmentSignInRequestSchema,
  developmentSignInResponseSchema,
  sessionResponseSchema,
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
});

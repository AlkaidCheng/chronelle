import { describe, expect, it } from "vitest";

import {
  objectAccessResponseSchema,
  permissionScopeUpdateRequestSchema,
  shareCreateRequestSchema,
} from "../src/sharing.js";

const resourceId = "019d6e7d-0000-7000-8000-000000000001";

describe("sharing schemas", () => {
  it("normalizes a supported user grant", () => {
    expect(
      shareCreateRequestSchema.parse({
        principalEmail: "VIEWER@EXAMPLE.COM",
        resourceId,
        role: "viewer",
      }),
    ).toEqual({
      principalEmail: "viewer@example.com",
      resourceId,
      role: "viewer",
    });
  });

  it("rejects unsupported roles and invalid concurrency versions", () => {
    expect(
      shareCreateRequestSchema.safeParse({
        principalEmail: "viewer@example.com",
        resourceId,
        role: "administrator",
      }).success,
    ).toBe(false);
    expect(
      permissionScopeUpdateRequestSchema.safeParse({
        expectedVersion: 0,
        permissionScopeId: resourceId,
      }).success,
    ).toBe(false);
  });

  it("accepts only known authorization actions", () => {
    expect(
      objectAccessResponseSchema.safeParse({
        resourceId,
        actions: ["view", "edit"],
      }).success,
    ).toBe(true);
    expect(
      objectAccessResponseSchema.safeParse({
        resourceId,
        actions: ["administer"],
      }).success,
    ).toBe(false);
  });
});

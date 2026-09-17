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
        source: { kind: "own" },
      }).success,
    ).toBe(true);
    expect(
      objectAccessResponseSchema.safeParse({
        resourceId,
        actions: ["administer"],
        source: { kind: "own" },
      }).success,
    ).toBe(false);
  });

  it("names the access source as own, a grant, or an inherited grant", () => {
    const account = { id: resourceId, displayName: "Mei" };
    for (const source of [
      { kind: "direct", grantedBy: account, role: "editor" },
      {
        kind: "inherited",
        through: account,
        grantedBy: account,
        role: "viewer",
      },
    ])
      expect(
        objectAccessResponseSchema.safeParse({
          resourceId,
          actions: ["view"],
          source,
        }).success,
      ).toBe(true);
    for (const source of [
      { kind: "referenced" },
      { kind: "direct", role: "editor" },
      { kind: "inherited", grantedBy: account, role: "viewer" },
    ])
      expect(
        objectAccessResponseSchema.safeParse({
          resourceId,
          actions: ["view"],
          source,
        }).success,
      ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  recoveryRequestSchema,
  relationDeletionQuerySchema,
  trashQuerySchema,
  removedRelationQuerySchema,
  removedRelationListResponseSchema,
} from "../src/recovery.js";

describe("recovery contracts", () => {
  it("requires bounded versions and rejects attempts to replay fields", () => {
    expect(recoveryRequestSchema.parse({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
    });
    for (const payload of [
      {},
      { expectedVersion: 0 },
      { expectedVersion: 2 ** 31 },
      { expectedVersion: 2, permissionScopeId: "forged" },
      { expectedVersion: 2, deletedAt: null },
    ]) {
      expect(recoveryRequestSchema.safeParse(payload).success).toBe(false);
    }
    expect(
      relationDeletionQuerySchema.parse({ expectedVersion: "3" })
        .expectedVersion,
    ).toBe(3);
  });
  it("bounds and validates filtered trash pagination", () => {
    expect(trashQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { beforeId: "bad" },
      { includeAll: true },
    ]) {
      expect(trashQuerySchema.safeParse(input).success).toBe(false);
    }
  });
  it("requires continuation information for removed links", () => {
    expect(removedRelationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      removedRelationQuerySchema.parse({
        limit: "50",
        relationType: "includes",
        cursor: "opaque_page",
      }),
    ).toEqual({ limit: 50, relationType: "includes", cursor: "opaque_page" });
    expect(
      removedRelationListResponseSchema.safeParse({ items: [] }).success,
    ).toBe(false);
    expect(
      removedRelationListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });
  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { cursor: "" },
    { cursor: "a=" },
    { cursor: "a".repeat(4097) },
    { relationType: "unknown" },
    { beforeId: "019d6e7d-0000-7000-8000-000000000001" },
    { includeAll: true },
  ])("rejects invalid removed-link query %j", (input) => {
    expect(removedRelationQuerySchema.safeParse(input).success).toBe(false);
  });
});

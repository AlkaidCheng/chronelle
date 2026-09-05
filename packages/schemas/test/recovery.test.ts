import { describe, expect, it } from "vitest";
import {
  recoveryRequestSchema,
  relationDeletionQuerySchema,
  trashQuerySchema,
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
});

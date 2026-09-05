import { describe, expect, it } from "vitest";
import {
  revisionComparisonQuerySchema,
  revisionRestoreRequestSchema,
} from "../src/revisions.js";

describe("restoration contracts", () => {
  it("accepts only the observed current version, not client-supplied snapshots", () => {
    expect(revisionRestoreRequestSchema.parse({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
    });
    for (const input of [
      { expectedVersion: 0 },
      { expectedVersion: "2" },
      { expectedVersion: 2, snapshot: {} },
      { expectedVersion: 2, sourceRevisionId: "forged" },
    ]) {
      expect(revisionRestoreRequestSchema.safeParse(input).success).toBe(false);
    }
  });
  it("bounds both selected version numbers and rejects extra query fields", () => {
    expect(
      revisionComparisonQuerySchema.parse({ fromVersion: "1", toVersion: "3" }),
    ).toEqual({ fromVersion: 1, toVersion: 3 });
    for (const input of [
      { fromVersion: 0, toVersion: 2 },
      { fromVersion: 1, toVersion: 2147483648 },
      { fromVersion: 1, toVersion: 2, workspaceId: "other" },
    ]) {
      expect(revisionComparisonQuerySchema.safeParse(input).success).toBe(
        false,
      );
    }
  });
});

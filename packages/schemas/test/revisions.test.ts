import { describe, expect, it } from "vitest";

import {
  revisionListQuerySchema,
  revisionParamsSchema,
} from "../src/revisions.js";

describe("revision queries", () => {
  it("bounds keyset pagination and rejects ambiguous input", () => {
    expect(revisionListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      revisionListQuerySchema.parse({ limit: "10", beforeVersion: "8" }),
    ).toEqual({ limit: 10, beforeVersion: 8 });
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { limit: "1.5" },
      { limit: "NaN" },
      { beforeVersion: 0 },
      { beforeVersion: 2_147_483_648 },
      { offset: 50 },
    ])
      expect(revisionListQuerySchema.safeParse(input).success).toBe(false);
    expect(
      revisionParamsSchema.safeParse({ id: "invalid", version: 1 }).success,
    ).toBe(false);
  });
});

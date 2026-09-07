import { describe, expect, it } from "vitest";
import {
  relationListQuerySchema,
  relationListResponseSchema,
} from "../src/index.js";

describe("active relation pages", () => {
  it("normalizes page sizes and requires continuation information", () => {
    expect(relationListQuerySchema.parse({})).toEqual({
      limit: 20,
      direction: "both",
    });
    expect(
      relationListQuerySchema.parse({
        limit: "1",
        direction: "outgoing",
        relationType: "includes",
        otherObjectId: "019d6e7d-0000-7000-8000-000000000001",
        cursor: "opaque_page",
      }),
    ).toMatchObject({ limit: 1, direction: "outgoing", cursor: "opaque_page" });
    expect(relationListResponseSchema.safeParse({ items: [] }).success).toBe(
      false,
    );
    expect(
      relationListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: "NaN" },
    { direction: "sideways" },
    { direction: ["incoming", "outgoing"] },
    { relationType: "anything" },
    { otherObjectId: "" },
    { otherObjectId: "not-a-uuid" },
    { cursor: "" },
    { cursor: "a=" },
    { cursor: "a".repeat(4097) },
  ])("rejects invalid query input %j", (input) => {
    expect(relationListQuerySchema.safeParse(input).success).toBe(false);
  });
});

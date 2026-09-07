import { describe, expect, it } from "vitest";

import { objectSearchQuerySchema } from "../src/search.js";

describe("object search schemas", () => {
  it("normalizes bounded search input", () => {
    expect(
      objectSearchQuerySchema.parse({
        limit: "12",
        objectType: "task",
        query: "  launch night  ",
      }),
    ).toEqual({ limit: 12, objectType: "task", query: "launch night" });
  });

  it("rejects empty syntax, unsupported types, and excessive limits", () => {
    expect(objectSearchQuerySchema.safeParse({ query: "**" }).success).toBe(
      false,
    );
    expect(
      objectSearchQuerySchema.safeParse({ objectType: "trip", query: "trip" })
        .success,
    ).toBe(false);
    expect(
      objectSearchQuerySchema.safeParse({ limit: 51, query: "launch" }).success,
    ).toBe(false);
  });

  it("bounds the optional cursor before decoding", () => {
    expect(
      objectSearchQuerySchema.parse({ query: "launch", cursor: "abc_123-XYZ" })
        .cursor,
    ).toBe("abc_123-XYZ");
    for (const cursor of ["", "a".repeat(2049), "with padding=", 123]) {
      expect(
        objectSearchQuerySchema.safeParse({ query: "launch", cursor }).success,
      ).toBe(false);
    }
  });
});

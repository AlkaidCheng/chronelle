import { describe, expect, it } from "vitest";
import { eventListQuerySchema, eventListResponseSchema } from "../src/index.js";

describe("Event collection contract", () => {
  it("defaults to a bounded date-ordered page and normalizes the name filter", () => {
    expect(eventListQuerySchema.parse({})).toEqual({
      limit: 20,
      query: "",
      scope: "all",
      filter: "all",
      sort: "date",
    });
    expect(
      eventListQuerySchema.parse({
        limit: "50",
        query: "  tea & cake  ",
        filter: "upcoming",
        sort: "name",
        cursor: "opaque_page",
      }),
    ).toEqual({
      limit: 50,
      query: "tea & cake",
      scope: "all",
      filter: "upcoming",
      sort: "name",
      cursor: "opaque_page",
    });
    expect(eventListResponseSchema.safeParse({ items: [] }).success).toBe(
      false,
    );
  });

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: "NaN" },
    { query: "x".repeat(241) },
    { filter: "unknown" },
    { sort: "unknown" },
    { cursor: "" },
    { cursor: "a=" },
    { cursor: "a".repeat(4097) },
  ])("rejects invalid collection input %j", (input) => {
    expect(eventListQuerySchema.safeParse(input).success).toBe(false);
  });
});

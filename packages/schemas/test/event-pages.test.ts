import { describe, expect, it } from "vitest";
import { eventLayoutUpdateSchema } from "../src/event-pages.js";

const page = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Preparation",
  components: [],
};

describe("event page layout input", () => {
  it("accepts an empty layout and trims page names", () => {
    expect(
      eventLayoutUpdateSchema.parse({ expectedVersion: 0, pages: [] }).pages,
    ).toEqual([]);
    expect(
      eventLayoutUpdateSchema.parse({
        expectedVersion: 1,
        pages: [{ ...page, name: " Preparation " }],
      }).pages[0]?.name,
    ).toBe("Preparation");
  });

  it.each([
    { expectedVersion: -1, pages: [] },
    { expectedVersion: 0, pages: [page, page] },
    { expectedVersion: 0, pages: Array(21).fill(page) },
    { expectedVersion: 0, pages: [{ ...page, name: " " }] },
    {
      expectedVersion: 0,
      pages: [{ ...page, components: [{ id: page.id, kind: "todos" }] }],
    },
    {
      expectedVersion: 0,
      pages: [
        {
          ...page,
          components: [
            { id: "00000000-0000-4000-8000-000000000002", kind: "script" },
          ],
        },
      ],
    },
    { expectedVersion: 0, pages: [{ ...page, canonicalTasks: [] }] },
  ])(
    "rejects malformed, duplicate or unsupported configuration: %j",
    (input) => {
      expect(eventLayoutUpdateSchema.safeParse(input).success).toBe(false);
    },
  );
});

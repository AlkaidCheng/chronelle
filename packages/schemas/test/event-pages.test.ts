import { describe, expect, it } from "vitest";
import {
  eventComponentKindSchema,
  eventLayoutUpdateSchema,
  eventLayoutRestoreSchema,
  eventLayoutHistoryQuerySchema,
} from "../src/event-pages.js";

const page = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Preparation",
  components: [],
};

describe("event page layout input", () => {
  it("bounds history requests and accepts the initial empty restore target", () => {
    expect(
      eventLayoutHistoryQuerySchema.parse({ beforeVersion: "12" }),
    ).toEqual({ beforeVersion: 12, limit: 10 });
    expect(
      eventLayoutRestoreSchema.parse({ expectedVersion: 2, targetVersion: 0 }),
    ).toEqual({ expectedVersion: 2, targetVersion: 0 });
    for (const query of [
      { limit: 0 },
      { limit: 21 },
      { beforeVersion: -1 },
      { beforeVersion: "invalid" },
      { extra: true },
    ])
      expect(eventLayoutHistoryQuerySchema.safeParse(query).success).toBe(
        false,
      );
    for (const input of [
      { expectedVersion: 2, targetVersion: -1 },
      { expectedVersion: 2_147_483_647, targetVersion: 1 },
      { expectedVersion: 1, targetVersion: 0, pages: [] },
    ])
      expect(eventLayoutRestoreSchema.safeParse(input).success).toBe(false);
  });
  it("accepts all planning components in one bounded layout", () => {
    const components = eventComponentKindSchema.options.map((kind) => ({
      id: crypto.randomUUID(),
      kind,
    }));
    expect(
      eventLayoutUpdateSchema.parse({
        expectedVersion: 2,
        pages: [{ ...page, components }],
      }).pages[0]?.components,
    ).toEqual(components);
  });

  it("keeps a component's view and refuses one it does not know", () => {
    const component = { id: crypto.randomUUID(), kind: "todos" as const };
    expect(
      eventLayoutUpdateSchema.parse({
        expectedVersion: 2,
        pages: [{ ...page, components: [{ ...component, view: "by-day" }] }],
      }).pages[0]?.components[0],
    ).toEqual({ ...component, view: "by-day" });
    for (const view of ["agenda", "week", "month"] as const) {
      expect(
        eventLayoutUpdateSchema.parse({
          expectedVersion: 2,
          pages: [{ ...page, components: [{ ...component, view }] }],
        }).pages[0]?.components[0]?.view,
      ).toBe(view);
    }
    expect(
      eventLayoutUpdateSchema.safeParse({
        expectedVersion: 2,
        pages: [{ ...page, components: [{ ...component, view: "grid" }] }],
      }).success,
    ).toBe(false);
  });

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
    {
      expectedVersion: 0,
      pages: [
        {
          ...page,
          components: [
            {
              id: "00000000-0000-4000-8000-000000000002",
              kind: "calendar",
              events: [],
            },
          ],
        },
      ],
    },
  ])(
    "rejects malformed, duplicate or unsupported configuration: %j",
    (input) => {
      expect(eventLayoutUpdateSchema.safeParse(input).success).toBe(false);
    },
  );
});

import type { ObjectSearchResult } from "@chronelle/schemas";
import { expect, it } from "vitest";
import { getSearchResultHref } from "../lib/search-result";

const result: ObjectSearchResult = {
  id: "019d6e7d-0000-7000-8000-000000000010",
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000010",
  displayName: "Gathering",
  objectType: "event",
  version: 1,
  updatedAt: "2026-09-04T20:00:00.000Z",
};

it("opens a root event at its canonical route", () => {
  expect(getSearchResultHref(result)).toBe(`/events/${result.id}`);
});

it.each(["event", "task", "expense", "document", "reminder"] as const)(
  "opens the event scope for an inherited %s",
  (objectType) => {
    const permissionScopeId = "019d6e7d-0000-7000-8000-000000000011";
    expect(
      getSearchResultHref({ ...result, objectType, permissionScopeId }),
    ).toBe(`/events/${permissionScopeId}`);
  },
);

it.each(["task", "expense", "document", "reminder"] as const)(
  "does not invent an event route for a root %s",
  (objectType) => {
    expect(getSearchResultHref({ ...result, objectType })).toBeNull();
  },
);

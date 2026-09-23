import type { EventPage } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  addComponent,
  addPage,
  hasComponentKind,
  moveComponent,
  movePage,
  removeComponent,
  removePage,
  renamePage,
  setComponentView,
} from "../src/features/planning/layout";

const ids = {
  pageA: "019d6e7d-0000-7000-8000-000000000001",
  pageB: "019d6e7d-0000-7000-8000-000000000002",
  todos: "019d6e7d-0000-7000-8000-000000000003",
  files: "019d6e7d-0000-7000-8000-000000000004",
} as const;

function pages(): EventPage[] {
  return [
    {
      id: ids.pageA,
      name: "Plan",
      components: [
        { id: ids.todos, kind: "todos" },
        { id: ids.files, kind: "files" },
      ],
    },
    { id: ids.pageB, name: "Guests", components: [] },
  ];
}

describe("Mini Program planning layout", () => {
  it("adds and renames pages without changing existing component identities", () => {
    const added = addPage(pages(), {
      id: "019d6e7d-0000-7000-8000-000000000005",
      name: "  Day of  ",
    });
    const renamed = renamePage(added, ids.pageA, "  Overview  ");
    expect(renamed.map((page) => page.name)).toEqual([
      "Overview",
      "Guests",
      "Day of",
    ]);
    expect(renamed[0]?.components.map((component) => component.id)).toEqual([
      ids.todos,
      ids.files,
    ]);
  });

  it("reorders pages and components with explicit bounded moves", () => {
    expect(movePage(pages(), ids.pageA, -1).map((page) => page.id)).toEqual([
      ids.pageA,
      ids.pageB,
    ]);
    expect(movePage(pages(), ids.pageA, 1).map((page) => page.id)).toEqual([
      ids.pageB,
      ids.pageA,
    ]);
    expect(
      moveComponent(pages(), ids.pageA, ids.files, -1)[0]?.components.map(
        (component) => component.id,
      ),
    ).toEqual([ids.files, ids.todos]);
  });

  it("removes layout references without deleting or rewriting other entries", () => {
    const withoutTodos = removeComponent(pages(), ids.pageA, ids.todos);
    expect(withoutTodos[0]?.components).toEqual([
      { id: ids.files, kind: "files" },
    ]);
    expect(removePage(withoutTodos, ids.pageA)).toEqual([
      { id: ids.pageB, name: "Guests", components: [] },
    ]);
  });

  it("preserves unsupported components while adding a native planning component", () => {
    const next = addComponent(pages(), ids.pageB, {
      id: "019d6e7d-0000-7000-8000-000000000006",
      kind: "expenses",
    });
    expect(hasComponentKind(next, "files")).toBe(true);
    expect(hasComponentKind(next, "expenses")).toBe(true);
  });

  it("stores a Task presentation on its existing component identity", () => {
    const next = setComponentView(pages(), ids.todos, "month");
    expect(next[0]?.components).toEqual([
      { id: ids.todos, kind: "todos", view: "month" },
      { id: ids.files, kind: "files" },
    ]);
  });

  it("rejects duplicate canonical layout identities", () => {
    expect(() =>
      addComponent(pages(), ids.pageB, {
        id: ids.todos,
        kind: "expenses",
      }),
    ).toThrow("Page and component IDs must be unique");
  });
});

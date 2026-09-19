import type { PersonResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  activePersonFilterCount,
  defaultPersonFilters,
  filterPersons,
  personAccount,
  personInitials,
  sortPersons,
} from "../lib/person-collection";

function person(
  id: string,
  displayName: string,
  fields: Partial<PersonResponse> = {},
): PersonResponse {
  return {
    id,
    workspaceId: "ws",
    objectType: "person",
    displayName,
    nickname: null,
    description: null,
    userId: null,
    contacts: [],
    labelIds: [],
    customProperties: {},
    version: 1,
    createdBy: "user",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    permissionScopeId: "scope",
    ...fields,
  } as PersonResponse;
}

describe("personInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(personInitials("Mira Chen")).toBe("MC");
    expect(personInitials("adam")).toBe("A");
    expect(personInitials("Anna Maria Rossi")).toBe("AM");
  });

  it("takes the first character of a Han, kana, or Hangul name", () => {
    expect(personInitials("陈爷爷")).toBe("陈");
    expect(personInitials("さくら")).toBe("さ");
    expect(personInitials("김민수")).toBe("김");
  });

  it("shows a question mark for an empty name", () => {
    expect(personInitials("  ")).toBe("?");
  });
});

describe("personAccount", () => {
  it("tells the signed-in user's person from other linked people", () => {
    expect(personAccount({ id: "p", userId: "me" }, "me")).toBe("me");
    expect(personAccount({ id: "p", userId: "other" }, "me")).toBe("linked");
    expect(personAccount({ id: "p", userId: null }, "me")).toBeNull();
    expect(personAccount({ id: "p", userId: "me" }, undefined)).toBe("linked");
  });

  it("knows a friend's account and a card that was invited", () => {
    const connections = {
      friends: new Set(["friend"]),
      invited: new Set(["card"]),
    };
    expect(
      personAccount({ id: "p", userId: "friend" }, "me", connections),
    ).toBe("friend");
    expect(personAccount({ id: "card", userId: null }, "me", connections)).toBe(
      "invited",
    );
    expect(personAccount({ id: "p", userId: "other" }, "me", connections)).toBe(
      "linked",
    );
    expect(
      personAccount({ id: "friend", userId: "friend" }, "friend", connections),
    ).toBe("me");
  });
});

describe("filterPersons", () => {
  const people = [
    person("a", "adam", { labelIds: ["work"] }),
    person("b", "Mira", { userId: "me", labelIds: ["family"] }),
    person("c", "Sofi", { userId: "other" }),
  ];

  it("passes everyone by default", () => {
    expect(filterPersons(people, defaultPersonFilters)).toHaveLength(3);
    expect(activePersonFilterCount(defaultPersonFilters)).toBe(0);
  });

  it("narrows by account and by label, counting each", () => {
    const linked = { account: "linked", label: "" } as const;
    expect(filterPersons(people, linked).map((p) => p.id)).toEqual(["b", "c"]);
    const unlinked = { account: "unlinked", label: "" } as const;
    expect(filterPersons(people, unlinked).map((p) => p.id)).toEqual(["a"]);
    const both = { account: "linked", label: "family" } as const;
    expect(filterPersons(people, both).map((p) => p.id)).toEqual(["b"]);
    expect(activePersonFilterCount(both)).toBe(2);
  });

  it("narrows to friends and to invited cards from what the account knows", () => {
    const connections = {
      friends: new Set(["other"]),
      invited: new Set(["a"]),
    };
    const friends = { account: "friend", label: "" } as const;
    expect(
      filterPersons(people, friends, connections).map((p) => p.id),
    ).toEqual(["c"]);
    const invited = { account: "invited", label: "" } as const;
    expect(
      filterPersons(people, invited, connections).map((p) => p.id),
    ).toEqual(["a"]);
    // Without what the account knows, neither narrowing matches anyone.
    expect(filterPersons(people, friends)).toEqual([]);
    expect(filterPersons(people, invited)).toEqual([]);
  });
});

describe("sortPersons", () => {
  it("orders by the shown name, case aside, or by the latest change", () => {
    const people = [
      person("a", "Zed", { updatedAt: "2026-09-02T00:00:00.000Z" }),
      person("b", "adam", { updatedAt: "2026-09-03T00:00:00.000Z" }),
      person("c", "Bea Long", {
        nickname: "Bee",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    expect(sortPersons(people, "name").map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortPersons(people, "updated").map((p) => p.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

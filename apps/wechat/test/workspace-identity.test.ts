import { describe, expect, it } from "vitest";

import {
  accountLine,
  matchesWorkspaceQuery,
  personInitials,
  splitMatch,
  workspaceIdentity,
} from "../src/account/workspace-identity";

const labels = {
  myWorkspace: "我的工作区",
  access: (role: "owner" | "editor" | "viewer") =>
    role === "owner" ? "所有者" : role === "editor" ? "可编辑" : "仅查看",
};

function workspace(
  overrides: Partial<{
    displayName: string;
    ownerDisplayName: string | null;
    personal: boolean;
    role: "owner" | "editor" | "viewer" | null;
  }> = {},
) {
  return {
    id: "019d6e7d-0000-7000-8000-000000000001",
    displayName: "陈凯's workspace",
    ownerDisplayName: "陈凯",
    personal: false,
    role: "editor" as const,
    ...overrides,
  };
}

describe("Mini Program workspace identity", () => {
  it("names the account's own workspace with a home mark", () => {
    const own = workspace({
      displayName: "林美's workspace",
      ownerDisplayName: "林美",
      personal: true,
      role: "owner",
    });

    expect(workspaceIdentity(own, labels)).toEqual({
      title: "我的工作区",
      access: null,
      detail: null,
      mark: { kind: "home" },
    });
    expect(accountLine("mei-lin", own, workspaceIdentity(own, labels))).toBe(
      "@mei-lin",
    );
  });

  it("reads a default-named shared workspace as its owner with the access", () => {
    const shared = workspace();
    const identity = workspaceIdentity(shared, labels);

    expect(identity).toEqual({
      title: "陈凯",
      access: "可编辑",
      detail: "可编辑",
      mark: { kind: "initials", text: "陈" },
    });
    expect(accountLine("mei-lin", shared, identity)).toBe("陈凯 · 可编辑");
  });

  it("keeps a renamed workspace's name and names its owner", () => {
    const renamed = workspace({
      displayName: "周末徒步社",
      ownerDisplayName: "何安",
      role: "viewer",
    });
    const identity = workspaceIdentity(renamed, labels);

    expect(identity.title).toBe("周末徒步社");
    expect(identity.detail).toBe("何安 · 仅查看");
    expect(accountLine("mei-lin", renamed, identity)).toBe(
      "周末徒步社 · 仅查看",
    );
  });

  it("omits the access for a workspace reached through shares alone", () => {
    const identity = workspaceIdentity(workspace({ role: null }), labels);

    expect(identity.access).toBeNull();
    expect(identity.detail).toBeNull();
  });

  it.each([
    ["林美", "林"],
    ["Ada Lovelace", "AL"],
    ["plato", "P"],
    ["  ", "?"],
  ])("derives initials from %j", (name, initials) => {
    expect(personInitials(name)).toBe(initials);
  });

  it("matches the title, owner, or access, ignoring case and spaces", () => {
    const identity = workspaceIdentity(
      workspace({ displayName: "Book Club", ownerDisplayName: "何安" }),
      labels,
    );

    expect(matchesWorkspaceQuery(identity, "  book ")).toBe(true);
    expect(matchesWorkspaceQuery(identity, "何")).toBe(true);
    expect(matchesWorkspaceQuery(identity, "可编辑")).toBe(true);
    expect(matchesWorkspaceQuery(identity, "")).toBe(true);
    expect(matchesWorkspaceQuery(identity, "trip")).toBe(false);
  });

  it("splits text around the first match for highlighting", () => {
    expect(splitMatch("周末徒步社", "徒步")).toEqual(["周末", "徒步", "社"]);
    expect(splitMatch("Book Club", "CLUB")).toEqual(["Book ", "Club", ""]);
    expect(splitMatch("读书会", "旅行")).toEqual(["读书会", "", ""]);
  });
});

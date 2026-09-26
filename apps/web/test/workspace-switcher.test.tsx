// @vitest-environment jsdom
import type { AccessibleWorkspace } from "@livtales/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../components/account-menu";
import { workspaceIdentity } from "../lib/workspace-identity";
import { groupWorkspaces, matchWorkspaces } from "../lib/workspace-recency";

const ids = {
  personal: "019d6e7d-0000-7000-8000-000000000001",
  kai: "019d6e7d-0000-7000-8000-000000000003",
  ana: "019d6e7d-0000-7000-8000-000000000004",
  mei: "019d6e7d-0000-7000-8000-000000000005",
};

const personal: AccessibleWorkspace = {
  id: ids.personal,
  displayName: "Planner's workspace",
  personal: true,
  ownerDisplayName: "Planner",
  role: "owner",
};
const ana: AccessibleWorkspace = {
  id: ids.ana,
  displayName: "Ana Souza's workspace",
  personal: false,
  ownerDisplayName: "Ana Souza",
  role: "viewer",
};
const kai: AccessibleWorkspace = {
  id: ids.kai,
  displayName: "Kai Tanaka's workspace",
  personal: false,
  ownerDisplayName: "Kai Tanaka",
  role: "editor",
};
const mei: AccessibleWorkspace = {
  id: ids.mei,
  displayName: "Mei Lin's workspace",
  personal: false,
  ownerDisplayName: "Mei Lin",
  role: null,
};
const workspaces: AccessibleWorkspace[] = [personal, ana, kai, mei];

const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

function sessionWith(
  available: AccessibleWorkspace[],
  current: string = ids.personal,
) {
  return {
    principal: {
      type: "user" as const,
      userId: "019d6e7d-0000-7000-8000-000000000002",
      workspaceId: current,
    },
    user: {
      id: "019d6e7d-0000-7000-8000-000000000002",
      displayName: "Planner",
      email: "planner@example.com",
      username: "planner",
      findByName: true,
      findByEmail: true,
      onboardedAt: "2026-09-01T09:00:00.000Z",
      locale: null,
      timeZone: null,
      hourCycle: null,
      weekStart: null,
      rail: {},
      eventTabs: {},
      workspaceRecency: { [ids.kai]: dayAgo, [ids.ana]: weekAgo },
    },
    workspace: {
      id: current,
      displayName:
        available.find((workspace) => workspace.id === current)?.displayName ??
        "",
    },
    availableWorkspaces: [...available],
  };
}

afterEach(cleanup);

function renderSwitcher(
  available: AccessibleWorkspace[] = workspaces,
  current?: string,
) {
  const onSwitch = vi.fn();
  render(
    <div className="workspace-shell">
      <AccountMenu
        session={sessionWith(available, current)}
        onSwitch={onSwitch}
        onSignOut={() => undefined}
      />
      <button type="button">Elsewhere</button>
    </div>,
  );
  return {
    onSwitch,
    trigger: screen.getByRole("button", { name: /^Planner / }),
    user: userEvent.setup(),
  };
}

/** Opens the block's menu and its Switch space... level. */
async function openList(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
) {
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Switch space..." }));
  return screen.getByRole("menu", { name: "Switch space" });
}

const labels = {
  personal: "Personal",
  role: (role: string) => role[0]?.toUpperCase() + role.slice(1),
};

describe("workspaceIdentity", () => {
  it("names the account's own workspace Personal with the account under it and the home mark", () => {
    expect(workspaceIdentity(personal, "Planner", labels)).toEqual({
      title: "Personal",
      detail: "Planner",
      mark: { kind: "home" },
    });
  });

  it("names a shared workspace by its owner with the role under it and the owner's initials", () => {
    expect(workspaceIdentity(kai, "Planner", labels)).toEqual({
      title: "Kai Tanaka",
      detail: "Editor",
      mark: { kind: "initials", text: "KT" },
    });
  });

  it("keeps a name the owner chose, with the owner under it", () => {
    expect(
      workspaceIdentity(
        { ...ana, displayName: "Autumn trip" },
        "Planner",
        labels,
      ),
    ).toEqual({
      title: "Autumn trip",
      detail: "Ana Souza",
      mark: { kind: "initials", text: "AS" },
    });
  });
});

describe("groupWorkspaces", () => {
  it("puts the account's own workspace first and the shared ones by when they were last opened, the never opened after them by name", () => {
    const groups = groupWorkspaces(workspaces, {
      [ids.kai]: dayAgo,
      [ids.ana]: weekAgo,
    });
    expect(groups.yours.map((workspace) => workspace.id)).toEqual([
      ids.personal,
    ]);
    expect(groups.shared.map((workspace) => workspace.id)).toEqual([
      ids.kai,
      ids.ana,
      ids.mei,
    ]);
  });

  it("matches the typed text against the name and the owner's name", () => {
    expect(matchWorkspaces(workspaces, "kai").map((w) => w.id)).toEqual([
      ids.kai,
    ]);
    expect(matchWorkspaces(workspaces, "  souza ").map((w) => w.id)).toEqual([
      ids.ana,
    ]);
    expect(matchWorkspaces(workspaces, "")).toBe(workspaces);
  });
});

it("opens the switcher with Yours first, then Shared with you by recency, the current one ticked and focused", async () => {
  const { trigger, user } = renderSwitcher();
  const menu = await openList(user, trigger);
  const items = screen.getAllByRole("menuitemradio");
  // Memberships alone: a workspace reached through shares (no role) is
  // absent, its events showing in the account's own Events list.
  expect(items.map((item) => item.textContent)).toEqual([
    "PersonalPlanner",
    "KTKai TanakaEditor · Opened yesterday",
    "ASAna SouzaViewer · Opened last week",
  ]);
  expect(items[0]).toHaveAttribute("aria-checked", "true");
  expect(items[0]).toHaveFocus();
  expect(menu).toHaveTextContent("Yours");
  expect(menu).toHaveTextContent("Shared with you");
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Members" })).toHaveAttribute(
    "href",
    "/settings/members",
  );
});

it("switches only to another workspace and closes", async () => {
  const { onSwitch, trigger, user } = renderSwitcher();
  await openList(user, trigger);
  await user.click(screen.getByRole("menuitemradio", { name: /^Personal/ }));
  expect(onSwitch).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await openList(user, trigger);
  await user.click(screen.getByRole("menuitemradio", { name: /Kai Tanaka/ }));
  expect(onSwitch).toHaveBeenCalledWith(ids.kai);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("offers a search past six workspaces that narrows the list by name or owner", async () => {
  const many = [
    ...workspaces,
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `019d6e7d-0000-7000-8000-00000000001${index}`,
      displayName: `Trip ${index}`,
      personal: false,
      ownerDisplayName: `Guide ${index}`,
      role: "viewer" as const,
    })),
  ];
  const { trigger, user } = renderSwitcher(many);
  await openList(user, trigger);
  const search = screen.getByRole("searchbox", { name: "Find a space" });
  expect(search).toHaveFocus();
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(7);
  await user.type(search, "guide 2");
  expect(
    screen.getAllByRole("menuitemradio").map((item) => item.textContent),
  ).toEqual(["G2Trip 2Guide 2"]);
  await user.clear(search);
  await user.type(search, "nobody");
  expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  expect(screen.getByText("No space matches.")).toBeVisible();
  // Escape leaves the list for the menu, and the menu for the block.
  await user.keyboard("{Escape}");
  expect(screen.getByRole("menu", { name: "Account" })).toBeVisible();
  expect(
    screen.getByRole("menuitem", { name: "Switch space..." }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("opens and closes with Cmd/Ctrl+Shift+K and closes on an outside press", async () => {
  const { trigger, user } = renderSwitcher();
  await user.keyboard("{Meta>}{Shift>}k{/Shift}{/Meta}");
  expect(screen.getByRole("menu", { name: "Switch space" })).toBeVisible();
  await user.keyboard("{Meta>}{Shift>}k{/Shift}{/Meta}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
  expect(screen.getByRole("menu", { name: "Switch space" })).toBeVisible();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

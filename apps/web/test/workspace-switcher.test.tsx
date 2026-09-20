// @vitest-environment jsdom
import type { AccessibleWorkspace } from "@chronelle/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "../components/workspace-switcher";
import { groupWorkspaces, matchWorkspaces } from "../lib/workspace-recency";

const ids = {
  personal: "019d6e7d-0000-7000-8000-000000000001",
  kai: "019d6e7d-0000-7000-8000-000000000003",
  ana: "019d6e7d-0000-7000-8000-000000000004",
  mei: "019d6e7d-0000-7000-8000-000000000005",
};

const workspaces: AccessibleWorkspace[] = [
  {
    id: ids.personal,
    displayName: "Planner's workspace",
    personal: true,
    ownerDisplayName: "Planner",
    role: "owner",
  },
  {
    id: ids.ana,
    displayName: "Ana Souza's workspace",
    personal: false,
    ownerDisplayName: "Ana Souza",
    role: "viewer",
  },
  {
    id: ids.kai,
    displayName: "Kai Tanaka's workspace",
    personal: false,
    ownerDisplayName: "Kai Tanaka",
    role: "editor",
  },
  {
    id: ids.mei,
    displayName: "Mei Lin's workspace",
    personal: false,
    ownerDisplayName: "Mei Lin",
    role: null,
  },
];

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
      <WorkspaceSwitcher
        session={sessionWith(available, current)}
        onSwitch={onSwitch}
      />
      <button type="button">Elsewhere</button>
    </div>,
  );
  return {
    onSwitch,
    trigger: screen.getByRole("button", {
      name: "Workspace: Planner's workspace",
    }),
    user: userEvent.setup(),
  };
}

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
  await user.click(trigger);
  const menu = screen.getByRole("menu", { name: "Switch workspace" });
  const items = screen.getAllByRole("menuitemradio");
  expect(items.map((item) => item.textContent)).toEqual([
    "PWPlanner's workspacePersonal workspace",
    "KTKai Tanaka's workspaceKai Tanaka · Editor · Opened yesterday",
    "ASAna Souza's workspaceAna Souza · Viewer · Opened last week",
    "MLMei Lin's workspaceMei Lin",
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
  await user.click(trigger);
  await user.click(
    screen.getByRole("menuitemradio", { name: /Planner's workspace/ }),
  );
  expect(onSwitch).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(
    screen.getByRole("menuitemradio", { name: /Kai Tanaka's workspace/ }),
  );
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
  await user.click(trigger);
  const search = screen.getByRole("searchbox", { name: "Find a workspace" });
  expect(search).toHaveFocus();
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(8);
  await user.type(search, "guide 2");
  expect(
    screen.getAllByRole("menuitemradio").map((item) => item.textContent),
  ).toEqual(["T2Trip 2Guide 2 · Viewer"]);
  await user.clear(search);
  await user.type(search, "nobody");
  expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  expect(screen.getByText("No workspace matches.")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("opens and closes with Cmd/Ctrl+Shift+K and closes on an outside press", async () => {
  const { trigger, user } = renderSwitcher();
  await user.keyboard("{Meta>}{Shift>}k{/Shift}{/Meta}");
  expect(screen.getByRole("menu", { name: "Switch workspace" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
  expect(screen.getByRole("menu", { name: "Switch workspace" })).toBeVisible();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

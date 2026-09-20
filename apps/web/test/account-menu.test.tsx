// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AccountMenu } from "../components/account-menu";

const session = {
  principal: {
    type: "user" as const,
    userId: "019d6e7d-0000-7000-8000-000000000002",
    workspaceId: "019d6e7d-0000-7000-8000-000000000001",
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
    workspaceRecency: {},
  },
  workspace: {
    id: "019d6e7d-0000-7000-8000-000000000001",
    displayName: "Planner's workspace",
  },
  availableWorkspaces: [
    {
      id: "019d6e7d-0000-7000-8000-000000000001",
      displayName: "Planner's workspace",
      personal: true,
      ownerDisplayName: "Planner",
      role: "owner" as const,
    },
    {
      id: "019d6e7d-0000-7000-8000-000000000003",
      displayName: "Kai Tanaka's workspace",
      personal: false,
      ownerDisplayName: "Kai Tanaka",
      role: "viewer" as const,
    },
  ],
};

afterEach(cleanup);

function renderMenu(extra: { pendingRequests?: number } = {}) {
  const onSignOut = vi.fn();
  const onSwitch = vi.fn();
  render(
    <div className="workspace-shell">
      <AccountMenu
        session={session}
        onSwitch={onSwitch}
        onSignOut={onSignOut}
        {...extra}
      />
      <button type="button">Elsewhere</button>
    </div>,
  );
  return {
    onSignOut,
    onSwitch,
    trigger: screen.getByRole("button", { name: "Planner Personal" }),
    user: userEvent.setup(),
  };
}

it("opens a menu with the account, the current workspace, Switch workspace, Friends, Settings, and sign out", async () => {
  const { trigger, user } = renderMenu();
  expect(trigger).toHaveTextContent("Personal");
  await user.click(trigger);
  const menu = screen.getByRole("menu", { name: "Account" });
  expect(menu).toHaveTextContent("planner@example.com");
  const current = screen.getByRole("menuitemradio", { name: /Personal/ });
  expect(current).toHaveAttribute("aria-checked", "true");
  expect(current).toHaveTextContent("PersonalPlanner");
  expect(current.querySelector(".workspace-mark-home")).not.toBeNull();
  expect(current).toHaveFocus();
  expect(menu).not.toHaveTextContent("Kai Tanaka");
  expect(
    screen.getByRole("menuitem", { name: "Switch workspace..." }),
  ).toHaveAttribute("aria-haspopup", "menu");
  expect(screen.getByRole("menuitem", { name: "Friends" })).toHaveAttribute(
    "href",
    "/friends",
  );
  expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await user.click(trigger);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("replaces the menu with the switcher's list and leads back from its first row or Escape", async () => {
  const { onSwitch, trigger, user } = renderMenu();
  await user.click(trigger);
  await user.click(
    screen.getByRole("menuitem", { name: "Switch workspace..." }),
  );
  const list = screen.getByRole("menu", { name: "Switch workspace" });
  const items = screen.getAllByRole("menuitemradio");
  expect(items.map((item) => item.textContent)).toEqual([
    "PersonalPlanner",
    "KTKai TanakaViewer",
  ]);
  expect(items[0]).toHaveFocus();
  expect(list).toHaveTextContent("Yours");
  expect(list).toHaveTextContent("Shared with you");
  expect(screen.getByRole("menuitem", { name: "Members" })).toHaveAttribute(
    "href",
    "/settings/members",
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("menu", { name: "Account" })).toBeVisible();
  await user.click(
    screen.getByRole("menuitem", { name: "Switch workspace..." }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Workspace" }));
  expect(screen.getByRole("menu", { name: "Account" })).toBeVisible();
  await user.click(
    screen.getByRole("menuitem", { name: "Switch workspace..." }),
  );
  await user.click(screen.getByRole("menuitemradio", { name: /Kai Tanaka/ }));
  expect(onSwitch).toHaveBeenCalledWith("019d6e7d-0000-7000-8000-000000000003");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("opens the switcher's list with Cmd/Ctrl+Shift+K and closes it again", async () => {
  const { trigger, user } = renderMenu();
  await user.keyboard("{Meta>}{Shift>}k{/Shift}{/Meta}");
  expect(screen.getByRole("menu", { name: "Switch workspace" })).toBeVisible();
  await user.keyboard("{Meta>}{Shift>}k{/Shift}{/Meta}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("signs out once and closes", async () => {
  const { onSignOut, trigger, user } = renderMenu();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("moves with arrow keys, closes on Escape, and returns focus to the block", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  await user.keyboard("{ArrowDown}");
  expect(
    screen.getByRole("menuitem", { name: "Switch workspace..." }),
  ).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitemradio", { name: /Personal/ })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("closes on an outside press without stealing focus", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  fireEvent.pointerDown(elsewhere);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).not.toHaveFocus();
});

it("counts the requests waiting on the Friends entry and marks the profile", async () => {
  const { trigger, user } = renderMenu({ pendingRequests: 2 });
  expect(trigger.querySelector(".profile-dot")).not.toBeNull();
  await user.click(trigger);
  expect(screen.getByRole("menuitem", { name: /Friends/ })).toHaveTextContent(
    "2",
  );
});

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
  },
  workspace: {
    id: "019d6e7d-0000-7000-8000-000000000001",
    displayName: "Personal",
  },
  availableWorkspaces: [
    { id: "019d6e7d-0000-7000-8000-000000000001", displayName: "Personal" },
    { id: "019d6e7d-0000-7000-8000-000000000003", displayName: "Shared" },
  ],
};

afterEach(cleanup);

function renderMenu(extra: { pendingRequests?: number } = {}) {
  const onSignOut = vi.fn();
  const onSwitchWorkspace = vi.fn();
  render(
    <>
      <AccountMenu
        session={session}
        onSwitchWorkspace={onSwitchWorkspace}
        onSignOut={onSignOut}
        {...extra}
      />
      <button type="button">Elsewhere</button>
    </>,
  );
  return {
    onSignOut,
    onSwitchWorkspace,
    trigger: screen.getByRole("button", { name: "Planner Personal" }),
    user: userEvent.setup(),
  };
}

it("opens a menu with the account, the workspaces, Friends, Settings, and sign out", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  const menu = screen.getByRole("menu", { name: "Account" });
  expect(menu).toHaveTextContent("planner@example.com");
  expect(
    screen.getByRole("menuitemradio", { name: "Personal" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menuitemradio", { name: "Personal" })).toHaveFocus();
  expect(screen.getByRole("menuitem", { name: "Friends" })).toHaveAttribute(
    "href",
    "/friends",
  );
  expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(
    screen.queryByRole("menuitem", { name: "Change password" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await user.click(trigger);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("switches only to another workspace and closes", async () => {
  const { onSwitchWorkspace, trigger, user } = renderMenu();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitemradio", { name: "Personal" }));
  expect(onSwitchWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitemradio", { name: "Shared" }));
  expect(onSwitchWorkspace).toHaveBeenCalledWith(
    "019d6e7d-0000-7000-8000-000000000003",
  );
});

it("signs out once and closes", async () => {
  const { onSignOut, trigger, user } = renderMenu();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("moves with arrow keys, closes on Escape, and returns focus to the profile", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitemradio", { name: "Shared" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitemradio", { name: "Personal" })).toHaveFocus();
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

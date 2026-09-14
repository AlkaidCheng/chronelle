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
    email: null,
  },
  workspace: {
    id: "019d6e7d-0000-7000-8000-000000000001",
    displayName: "Personal",
  },
  availableWorkspaces: [
    { id: "019d6e7d-0000-7000-8000-000000000001", displayName: "Personal" },
  ],
};

afterEach(cleanup);

function renderMenu() {
  const onSignOut = vi.fn();
  render(
    <>
      <AccountMenu session={session} onSignOut={onSignOut} />
      <button type="button">Elsewhere</button>
    </>,
  );
  return {
    onSignOut,
    trigger: screen.getByRole("button", { name: "Planner Personal" }),
    user: userEvent.setup(),
  };
}

it("reveals Sign out beneath the profile and hides it again", async () => {
  const { trigger, user } = renderMenu();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  await user.click(trigger);
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

it("signs out once and collapses", async () => {
  const { onSignOut, trigger, user } = renderMenu();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

it("collapses on Escape and returns focus to the profile button", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  screen.getByRole("button", { name: "Sign out" }).focus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  expect(trigger).toHaveFocus();
});

it("ignores Escape pressed elsewhere and collapses on an outside press", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.focus();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  fireEvent.pointerDown(elsewhere);
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

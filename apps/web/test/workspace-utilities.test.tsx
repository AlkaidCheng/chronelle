// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceUtilities } from "../components/workspace-utilities";
import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const otherId = "019d6e7d-0000-7000-8000-000000000002";
const session = {
  principal: { type: "user" as const, userId: otherId, workspaceId },
  user: { id: otherId, displayName: "Planner", email: null },
  workspace: { id: workspaceId, displayName: "Personal" },
  availableWorkspaces: [
    { id: workspaceId, displayName: "Personal" },
    { id: otherId, displayName: "Shared" },
  ],
};
const methods = ["showModal", "close"] as const;
const descriptors = methods.map((method) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
);

beforeEach(() => {
  for (const method of methods)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  methods.forEach((method, index) => {
    const descriptor = descriptors[index];
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  });
});

function Harness() {
  const auth = useAuthSession();
  return (
    <>
      <WorkspaceUtilities
        session={session}
        onSwitchWorkspace={auth.switchWorkspace}
        onSignOut={auth.signOut}
      />
      <button type="button" onClick={auth.signOut}>
        Expire session
      </button>
      <button type="button" onClick={() => auth.switchWorkspace(otherId)}>
        Change workspace externally
      </button>
      <button
        type="button"
        onClick={() =>
          auth.startSession({ accessToken: "replacement", workspaceId })
        }
      >
        Replace identity
      </button>
    </>
  );
}

async function openUtilities() {
  const user = userEvent.setup();
  render(
    <AuthSessionProvider>
      <Harness />
    </AuthSessionProvider>,
  );
  await user.click(screen.getByRole("button", { name: "More" }));
  return {
    user,
    dialog: screen.getByRole("dialog", { name: "Workspace settings" }),
  };
}

it.each(["Expire session", "Change workspace externally", "Replace identity"])(
  "dismisses both dialogs on %s",
  async (action) => {
    const { user } = await openUtilities();
    await user.click(
      screen.getByRole("button", { name: "Customize appearance" }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  },
);

it("returns focus on cancel and ignores presses starting inside the dialog", async () => {
  const { dialog } = await openUtilities();
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Workspace" }));
  fireEvent.pointerUp(dialog);
  expect(dialog).toBeInTheDocument();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
});

it("dismisses on a backdrop press", async () => {
  const { dialog } = await openUtilities();
  fireEvent.pointerDown(dialog);
  fireEvent.pointerUp(dialog);
  expect(dialog).not.toBeInTheDocument();
});

it("keeps workspace settings open when the nested appearance dialog is canceled", async () => {
  const { user, dialog } = await openUtilities();
  const customize = screen.getByRole("button", {
    name: "Customize appearance",
  });
  await user.click(customize);
  const appearance = screen.getByRole("dialog", { name: "Appearance" });
  fireEvent(appearance, new Event("cancel", { cancelable: true }));
  expect(appearance).not.toBeInTheDocument();
  expect(dialog).toBeInTheDocument();
  expect(customize).toHaveFocus();
});

it("switches only to the selected workspace and closes before leaving", async () => {
  const change = vi.fn();
  render(
    <AuthSessionProvider>
      <WorkspaceUtilities
        session={session}
        onSwitchWorkspace={change}
        onSignOut={vi.fn()}
      />
    </AuthSessionProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Workspace" }),
    workspaceId,
  );
  expect(change).not.toHaveBeenCalled();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Workspace" }),
    otherId,
  );
  expect(change).toHaveBeenCalledExactlyOnceWith(otherId);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HistoryDrawer } from "../features/history/history-drawer";
import { RecoveryDialog } from "../features/recovery/recovery-dialog";
import { ApiClientProvider } from "../lib/api-context";
import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const objectId = "019d6e7d-0000-7000-8000-000000000002";
const dialogMethods = ["showModal", "close"] as const;
const dialogDescriptors = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);

beforeAll(() => {
  for (const name of dialogMethods)
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
});

afterAll(() => {
  dialogMethods.forEach((name, index) => {
    const descriptor = dialogDescriptors[index];
    if (descriptor === undefined)
      Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
  });
});

beforeEach(() => {
  window.sessionStorage.setItem(
    "chronelle.development-session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [], nextBeforeVersion: null })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function Harness({ kind }: { readonly kind: "history" | "recovery" }) {
  const [open, setOpen] = useState(false);
  const [hasTrigger, setHasTrigger] = useState(true);
  const [count, setCount] = useState(0);
  const session = useAuthSession();
  return (
    <main id="workspace-content" tabIndex={-1}>
      {hasTrigger ? (
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
      ) : null}
      <button type="button" onClick={() => setHasTrigger(false)}>
        Remove trigger
      </button>
      <button type="button" onClick={() => setCount(count + 1)}>
        Rerender {count}
      </button>
      <button type="button" onClick={session.signOut}>
        Sign out
      </button>
      <button type="button" onClick={() => session.switchWorkspace(objectId)}>
        Switch workspace
      </button>
      <button
        type="button"
        onClick={() =>
          session.startSession({
            accessToken: "replacement-session",
            workspaceId,
          })
        }
      >
        Replace session
      </button>
      {open ? (
        kind === "history" ? (
          <HistoryDrawer
            objectId={objectId}
            displayName="Plan"
            onClose={() => setOpen(false)}
          />
        ) : (
          <RecoveryDialog title="Plan" onClose={() => setOpen(false)}>
            Recovery preview
          </RecoveryDialog>
        )
      ) : null}
    </main>
  );
}

async function openDialog(kind: "history" | "recovery") {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <StrictMode>
      <AuthSessionProvider>
        <QueryClientProvider client={client}>
          <ApiClientProvider>
            <Harness kind={kind} />
          </ApiClientProvider>
        </QueryClientProvider>
      </AuthSessionProvider>
    </StrictMode>,
  );
  await user.click(screen.getByRole("button", { name: "Open dialog" }));
  const dialog = screen.getByRole("dialog", { name: "Plan" });
  expect(dialog).toHaveAttribute("open");
  return { user, dialog };
}

describe.each(["history", "recovery"] as const)(
  "%s dialog lifecycle",
  (kind) => {
    it("closes the native dialog and returns focus to its trigger", async () => {
      const { user, dialog } = await openDialog(kind);
      await user.click(screen.getByRole("button", { name: /^Close/ }));
      expect(dialog).not.toHaveAttribute("open");
      expect(dialog).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open dialog" })).toHaveFocus();
    });

    it("returns focus to the workspace when the trigger disappears", async () => {
      const { user } = await openDialog(kind);
      fireEvent.click(screen.getByRole("button", { name: "Remove trigger" }));
      await user.click(screen.getByRole("button", { name: /^Close/ }));
      expect(screen.getByRole("main")).toHaveFocus();
    });

    it("returns focus to the workspace when the trigger is disabled", async () => {
      const { user } = await openDialog(kind);
      screen
        .getByRole("button", { name: "Open dialog" })
        .setAttribute("disabled", "");
      await user.click(screen.getByRole("button", { name: /^Close/ }));
      expect(screen.getByRole("main")).toHaveFocus();
    });

    it("handles the native cancel event used by Escape", async () => {
      const { dialog } = await openDialog(kind);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(dialog).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open dialog" })).toHaveFocus();
    });

    it("does not reopen or close on an unrelated rerender", async () => {
      const { dialog } = await openDialog(kind);
      const openings = vi.mocked(HTMLDialogElement.prototype.showModal).mock
        .calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Rerender 0" }));
      expect(dialog).toHaveAttribute("open");
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(
        openings,
      );
    });

    it.each(["Sign out", "Switch workspace", "Replace session"])(
      "closes on %s without relying on a keyed provider remount",
      async (action) => {
        const { dialog } = await openDialog(kind);
        fireEvent.click(screen.getByRole("button", { name: action }));
        expect(dialog).not.toBeInTheDocument();
      },
    );
  },
);

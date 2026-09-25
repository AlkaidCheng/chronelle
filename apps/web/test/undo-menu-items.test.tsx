// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eventResponseSchema } from "@livtales/schemas";
import { Providers } from "../app/providers";
import { QuietMenu } from "../components/quiet-menu";
import { UndoMenuItems } from "../components/undo-menu-items";
import { useUpdateEvent } from "../lib/queries";
import { useContentUndoShortcut } from "../lib/use-content-undo-shortcut";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let initial: ReturnType<typeof eventResponseSchema.parse>;

function Harness() {
  const update = useUpdateEvent();
  useContentUndoShortcut();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          update.mutate({
            id: initial.id,
            workspaceId: initial.workspaceId,
            input: { expectedVersion: 1, displayName: "Garden night" },
          })
        }
      >
        Rename
      </button>
      <QuietMenu label="More" icon={<span />}>
        <UndoMenuItems />
      </QuietMenu>
    </>
  );
}

async function currentName() {
  const response = await store.fetch(`/api/events/${initial.id}`);
  return ((await response.json()) as { displayName: string }).displayName;
}

beforeEach(async () => {
  let stored: string | null = null;
  store = new SandboxStore({
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  const response = await store.fetch("/api/events", {
    method: "POST",
    body: JSON.stringify({ displayName: "Garden evening" }),
  });
  initial = eventResponseSchema.parse(await response.json());
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, options) => store.fetch(input, options)),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

it("names the edit to undo, undoes it from the menu, and redoes it from the keyboard", async () => {
  const user = userEvent.setup();
  render(<Harness />, { wrapper: Providers });
  await user.click(screen.getByRole("button", { name: "More" }));
  const undo = await screen.findByRole("menuitem", { name: /^Undo edit/ });
  expect(undo).toHaveAttribute("aria-disabled", "true");
  expect(undo).toHaveTextContent("Nothing to undo");
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(async () => expect(await currentName()).toBe("Garden night"));
  await user.click(screen.getByRole("button", { name: "More" }));
  const named = await screen.findByRole("menuitem", {
    name: /Undo: rename Garden night/,
  });
  expect(named).not.toHaveAttribute("aria-disabled");
  await user.click(named);
  await waitFor(async () => expect(await currentName()).toBe("Garden evening"));

  // Cmd/Ctrl+Z outside a text field reaches the workspace stack.
  await user.keyboard("{Shift>}{Meta>}z{/Meta}{/Shift}");
  await waitFor(async () => expect(await currentName()).toBe("Garden night"));
  await user.click(screen.getByRole("button", { name: "More" }));
  expect(
    await screen.findByRole("menuitem", { name: /Redo edit/ }),
  ).toHaveAttribute("aria-disabled", "true");
});

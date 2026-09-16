// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { CreateEventDialog } from "../features/events/create-event-dialog";
import { useAuthSession } from "../lib/auth-session";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { setDates } from "./range-picker-support";

let store: SandboxStore;
const onCreated = vi.fn();

function Harness() {
  const [open, setOpen] = useState(false);
  const session = useAuthSession();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New event
      </button>
      <button type="button" onClick={session.signOut}>
        Sign out
      </button>
      <button
        type="button"
        onClick={() =>
          session.switchWorkspace("019d6e7d-0000-7000-8000-000000000002")
        }
      >
        Switch workspace
      </button>
      {open && (
        <CreateEventDialog
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      )}
    </>
  );
}

async function openEditor() {
  const user = userEvent.setup();
  render(
    <Providers>
      <Harness />
    </Providers>,
  );
  await user.click(screen.getByRole("button", { name: "New event" }));
  return user;
}

function unloadIsPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  onCreated.mockClear();
  store = new SandboxStore({ getItem: () => null, setItem: () => {} });
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, options) => store.fetch(input, options)),
  );
  for (const method of ["showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("event creation drafts", () => {
  it.each(["Cancel", "Close event creation", "Escape"])(
    "closes an untouched draft with %s",
    async (action) => {
      const user = await openEditor();
      expect(unloadIsPrevented()).toBe(false);
      if (action === "Escape")
        fireEvent(
          screen.getByRole("dialog"),
          new Event("cancel", { cancelable: true }),
        );
      else await user.click(screen.getByRole("button", { name: action }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["Cancel", "Close event creation", "Escape"])(
    "confirms %s without losing fields, calendar state or focus",
    async (action) => {
      const user = await openEditor();
      const name = screen.getByLabelText("Event name");
      await user.type(name, "Garden evening");
      await user.click(screen.getByRole("switch", { name: "Set dates" }));
      await setDates(user, "2030-07-03", "2030-07-12");
      name.focus();
      const returnTarget =
        action === "Escape"
          ? name
          : screen.getByRole("button", { name: action });
      if (action === "Escape")
        fireEvent(
          screen.getByRole("dialog"),
          new Event("cancel", { cancelable: true }),
        );
      else await user.click(returnTarget);
      expect(
        screen.getByRole("dialog", { name: "Discard this event?" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Keep editing" }),
      ).toHaveFocus();
      expect(name).not.toBeVisible();
      expect(unloadIsPrevented()).toBe(true);
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { cancelable: true }),
      );
      expect(returnTarget).toHaveFocus();
      expect(name).toHaveValue("Garden evening");
      expect(screen.getByRole("table", { name: "July 2030" })).toBeVisible();
      expect(
        screen.getByText("Dates: Jul 3, 2030 to Jul 12, 2030"),
      ).toBeVisible();
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { cancelable: true }),
      );
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(name).toHaveValue("Garden evening");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("discards only after confirmation and opens a fresh draft", async () => {
    const user = await openEditor();
    await user.type(screen.getByLabelText("Event name"), "Unfinished plan");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(unloadIsPrevented()).toBe(false);
    await user.click(screen.getByRole("button", { name: "New event" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("");
    expect(screen.getByRole("switch", { name: "Set dates" })).not.toBeChecked();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("protects a schedule-only draft but permits closing reverted empty fields", async () => {
    const user = await openEditor();
    await user.click(screen.getByRole("switch", { name: "Set dates" }));
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(
      screen.getByRole("dialog", { name: "Discard this event?" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await user.click(screen.getByRole("switch", { name: "Set dates" }));
    await user.type(screen.getByLabelText("Event name"), "Temporary");
    await user.clear(screen.getByLabelText("Event name"));
    expect(unloadIsPrevented()).toBe(false);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps pending saves locked, preserves failed drafts, and clears protection on success", async () => {
    let fail: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = resolve;
        }),
    );
    const user = await openEditor();
    await user.type(screen.getByLabelText("Event name"), "A real event");
    await user.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close event creation" }),
    ).toBeDisabled();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(
      screen.getByRole("dialog", { name: "Create an event" }),
    ).toBeVisible();
    expect(unloadIsPrevented()).toBe(true);
    fail(
      Response.json(
        {
          error: {
            code: "internal_error",
            message: "Could not save",
            requestId: "test",
          },
        },
        { status: 500 },
      ),
    );
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("A real event");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    await user.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(unloadIsPrevented()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["Sign out", "Switch workspace"])(
    "clears a dirty confirmation immediately on %s",
    async (action) => {
      const user = await openEditor();
      await user.type(screen.getByLabelText("Event name"), "Private draft");
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { cancelable: true }),
      );
      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(unloadIsPrevented()).toBe(false);
      // Sign out ends the cookie session with one DELETE; the draft sends nothing.
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([, init]) => init?.method !== "DELETE"),
      ).toHaveLength(0);
    },
  );
});

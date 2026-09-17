// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventResponseSchema } from "@chronelle/schemas";
import { Providers } from "../app/providers";
import { EventInspector } from "../features/events/event-inspector";
import { useAuthSession } from "../lib/auth-session";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { setDates } from "./range-picker-support";

let store: SandboxStore;
let initial: ReturnType<typeof eventResponseSchema.parse>;

function Harness() {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState(initial);
  const session = useAuthSession();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Inspect event
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
      <button
        type="button"
        onClick={() =>
          setEvent({ ...event, version: 2, displayName: "Collaborator name" })
        }
      >
        Receive newer version
      </button>
      {open && <EventInspector event={event} onClose={() => setOpen(false)} />}
    </>
  );
}

async function openInspector() {
  const user = userEvent.setup();
  render(<Harness />, { wrapper: Providers });
  await user.click(screen.getByRole("button", { name: "Inspect event" }));
  expect(screen.getByLabelText("Name")).toHaveFocus();
  return user;
}

function cancelInspector() {
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
}

function unloadIsPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
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

describe("Event inspector", () => {
  it("opens canonical history without discarding the draft and restores focus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ items: [], nextBeforeVersion: null }),
    );
    const user = await openInspector();
    await user.type(screen.getByLabelText("Name"), " private draft");
    const history = screen.getByRole("button", { name: "View event history" });
    await user.click(history);
    expect(
      await screen.findByRole("dialog", { name: initial.displayName }),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/objects/${initial.id}/revisions`),
      expect.anything(),
    );
    await user.click(screen.getByRole("button", { name: "Close history" }));
    expect(history).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveValue(
      "Garden evening private draft",
    );
    expect(unloadIsPrevented()).toBe(true);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
  it.each(["Cancel", "Close event editor", "Escape"])(
    "closes a clean draft with %s and restores focus",
    async (action) => {
      const user = await openInspector();
      expect(unloadIsPrevented()).toBe(false);
      if (action === "Escape") cancelInspector();
      else await user.click(screen.getByRole("button", { name: action }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Inspect event" }),
      ).toHaveFocus();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["Cancel", "Close event editor", "Escape"])(
    "confirms %s while retaining fields, calendar navigation and focus",
    async (action) => {
      const user = await openInspector();
      const name = screen.getByLabelText("Name");
      await user.clear(name);
      await user.type(name, "Evening in the garden");
      await user.click(screen.getByRole("switch", { name: "Set dates" }));
      await setDates(user, "2040-07-03");
      name.focus();
      const target =
        action === "Escape"
          ? name
          : screen.getByRole("button", { name: action });
      if (action === "Escape") cancelInspector();
      else await user.click(target);
      expect(
        screen.getByRole("dialog", { name: "Discard changes?" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Keep editing" }),
      ).toHaveFocus();
      expect(name).not.toBeVisible();
      expect(unloadIsPrevented()).toBe(true);
      cancelInspector();
      expect(target).toHaveFocus();
      expect(name).toHaveValue("Evening in the garden");
      expect(screen.getByText("Dates: Jul 3, 2040")).toBeVisible();
      expect(screen.getByRole("table", { name: "July 2040" })).toBeVisible();
      cancelInspector();
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(unloadIsPrevented()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("treats reverted fields as clean and resets the baseline on explicit latest load", async () => {
    const user = await openInspector();
    const name = screen.getByLabelText("Name");
    await user.type(name, " changed");
    expect(unloadIsPrevented()).toBe(true);
    await user.clear(name);
    await user.type(name, initial.displayName);
    expect(unloadIsPrevented()).toBe(false);
    await user.type(name, " private draft");
    fireEvent.click(
      screen.getByRole("button", { name: "Receive newer version" }),
    );
    expect(name).toHaveValue("Garden evening private draft");
    expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Discard draft and load latest" }),
    );
    expect(name).toHaveValue("Collaborator name");
    expect(unloadIsPrevented()).toBe(false);
    cancelInspector();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("locks pending saves, retains failed drafts, then saves one canonical version", async () => {
    // The write is held until the test answers it; the command state read
    // before it reaches the store.
    let complete: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation((input, options) => {
      if (options?.method !== "POST") return store.fetch(input, options);
      vi.mocked(fetch).mockImplementation((next, nextOptions) =>
        store.fetch(next, nextOptions),
      );
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const user = await openInspector();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Saved garden evening");
    await user.click(screen.getByRole("button", { name: "Save event" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close event editor" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "View event history" }),
    ).toBeDisabled();
    cancelInspector();
    expect(screen.getByRole("dialog", { name: "Edit event" })).toBeVisible();
    await act(async () =>
      complete(
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
      ),
    );
    await screen.findByRole("alert");
    cancelInspector();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Saved garden evening");
    await user.click(screen.getByRole("button", { name: "Save event" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(unloadIsPrevented()).toBe(false);
    const response = await store.fetch(`/api/events/${initial.id}`);
    expect(await response.json()).toMatchObject({
      id: initial.id,
      version: 2,
      displayName: "Saved garden evening",
    });
  });

  it.each(["Sign out", "Switch workspace"])(
    "clears a private draft immediately on %s",
    async (action) => {
      const user = await openInspector();
      await user.type(screen.getByLabelText("Name"), " private draft");
      cancelInspector();
      fireEvent.click(screen.getByRole("button", { name: action }));
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

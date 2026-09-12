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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { CalendarPanel } from "../features/events/planning-panels";
import { useAuthSession } from "../lib/auth-session";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let eventId: string;

function Harness({ canEdit = true }: { canEdit?: boolean }) {
  const session = useAuthSession();
  return (
    <>
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
      <CalendarPanel canEdit={canEdit} eventId={eventId} items={[]} />
    </>
  );
}

async function openEditor() {
  const user = userEvent.setup();
  render(<Harness />, { wrapper: Providers });
  await user.click(screen.getByRole("button", { name: "Add schedule item" }));
  return user;
}

function unloadIsPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(async () => {
  store = new SandboxStore({ getItem: () => null, setItem: () => {} });
  const events = await (await store.fetch("/api/events")).json();
  eventId = events.items[0].id;
  window.sessionStorage.setItem(
    "chronelle.development-session",
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

describe("schedule creation dialog", () => {
  it.each(["Cancel", "Close schedule creation", "Escape"])(
    "closes untouched fields with %s and returns focus",
    async (action) => {
      const user = await openEditor();
      expect(screen.getByLabelText("Schedule item")).toHaveFocus();
      expect(unloadIsPrevented()).toBe(false);
      if (action === "Escape")
        fireEvent(
          screen.getByRole("dialog"),
          new Event("cancel", { cancelable: true }),
        );
      else await user.click(screen.getByRole("button", { name: action }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Add schedule item" }),
      ).toHaveFocus();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps fields, calendar position and focus while confirming discard", async () => {
    const user = await openEditor();
    const name = screen.getByLabelText("Schedule item");
    await user.type(name, "Garden welcome");
    await user.click(screen.getByRole("button", { name: "Change year" }));
    await user.click(screen.getByRole("button", { name: "2030" }));
    await user.click(screen.getByRole("button", { name: "Change month" }));
    await user.click(screen.getByRole("button", { name: "July" }));
    await user.click(screen.getByRole("button", { name: "Jul 3, 2030" }));
    name.focus();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(
      screen.getByRole("dialog", { name: "Discard schedule item?" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    expect(name).not.toBeVisible();
    expect(unloadIsPrevented()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Garden welcome");
    expect(screen.getByRole("grid", { name: "July 2030" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(unloadIsPrevented()).toBe(false);
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    expect(screen.getByLabelText("Schedule item")).toHaveValue("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries unchanged input with the same context command after a failed save", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Connection interrupted"))
      .mockImplementation((input, options) => store.fetch(input, options));
    vi.stubGlobal("fetch", request);
    const user = await openEditor();
    await user.type(screen.getByLabelText("Schedule item"), "Arrival");
    await user.click(screen.getByRole("switch", { name: "Set dates" }));
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be reached",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Schedule item")).toHaveValue("Arrival");
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(request).toHaveBeenCalledTimes(2);
    const bodies = request.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({
      commandId: expect.any(String),
      resource: {
        objectType: "event",
        displayName: "Arrival",
        startsOn: null,
        endsOn: null,
        startsAt: null,
        endsAt: null,
        isAllDay: false,
      },
    });
    expect(request.mock.calls.map(([url]) => url)).toEqual(
      Array(2).fill(`/api/events/${eventId}/resources`),
    );
    expect(unloadIsPrevented()).toBe(false);
  });

  it("blocks duplicate submission and dismissal while the linked create is pending", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn<typeof fetch>(async (input, options) => {
      await pending;
      return store.fetch(input, options);
    });
    vi.stubGlobal("fetch", request);
    const user = await openEditor();
    await user.type(screen.getByLabelText("Schedule item"), "Arrival");
    await user.click(screen.getByRole("switch", { name: "Set dates" }));
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close schedule creation" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Schedule item")).toBeDisabled();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    const form = screen.getByRole("dialog").querySelector("form");
    if (!form) throw new Error("Schedule form not found.");
    fireEvent.submit(form);
    expect(
      screen.getByRole("dialog", { name: "Add schedule item" }),
    ).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each(["Sign out", "Switch workspace"])(
    "clears unsaved fields on %s",
    async (action) => {
      const user = await openEditor();
      await user.type(screen.getByLabelText("Schedule item"), "Private plan");
      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(unloadIsPrevented()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("removes creation when parent edit access is withdrawn", async () => {
    const user = userEvent.setup();
    const view = render(<Harness />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    await user.type(screen.getByLabelText("Schedule item"), "Private plan");
    view.rerender(<Harness canEdit={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add schedule item" }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

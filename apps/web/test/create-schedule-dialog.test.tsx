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
import { Providers } from "../app/providers";
import { CalendarPanel } from "../features/events/planning-panels";
import { useAuthSession } from "../lib/auth-session";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { dateRow, setDates } from "./date-rows";

let store: SandboxStore;
let eventId: string;
let otherEventId: string;

function Harness({ canEdit = true }: { canEdit?: boolean }) {
  const session = useAuthSession();
  const [visible, setVisible] = useState(true);
  const [parentId, setParentId] = useState(eventId);
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
      <button type="button" onClick={() => setVisible(false)}>
        Navigate away
      </button>
      <button type="button" onClick={() => setVisible(true)}>
        Return to Calendar
      </button>
      <button
        type="button"
        onClick={() =>
          setParentId(parentId === eventId ? otherEventId : eventId)
        }
      >
        Switch parent
      </button>
      {visible && (
        <CalendarPanel
          key={parentId}
          canEdit={canEdit}
          eventId={parentId}
          items={[]}
        />
      )}
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
  let stored: string | null = null;
  store = new SandboxStore({
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  const events = await (await store.fetch("/api/events")).json();
  eventId = events.items[0].id;
  otherEventId = events.items[1].id;
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

function navigateAway() {
  fireEvent.click(screen.getByRole("button", { name: "Navigate away" }));
}

async function reopen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Return to Calendar" }));
  await user.click(screen.getByRole("button", { name: "Add schedule item" }));
}

async function enterDraft() {
  const user = await openEditor();
  await user.type(screen.getByLabelText("Schedule item"), "Private arrival");
  return user;
}

function failure(status: number) {
  return Response.json(
    {
      error: { code: "unavailable", message: "Unavailable", requestId: "test" },
    },
    { status },
  );
}

describe("schedule drafts across navigation", () => {
  it("keeps fields private until a fresh parent access check succeeds", async () => {
    const user = await enterDraft();
    navigateAway();
    expect(unloadIsPrevented()).toBe(true);
    await reopen(user);
    expect(screen.queryByDisplayValue("Private arrival")).toBeNull();
    const check = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => check.promise);
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(
      screen.getByRole("button", { name: "Checking access..." }),
    ).toBeDisabled();
    expect(screen.queryByDisplayValue("Private arrival")).toBeNull();
    await act(async () =>
      check.resolve(await store.fetch(`/api/events/${eventId}`)),
    );
    expect(await screen.findByDisplayValue("Private arrival")).toHaveFocus();
    expect(dateRow(/^Set dates/)).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      `/api/objects/${eventId}/access`,
      expect.anything(),
    );
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem("chronelle.session")).not.toContain(
      "Private arrival",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(unloadIsPrevented()).toBe(false);
  });

  it("separates schedule drafts belonging to different parent Events", async () => {
    const user = await enterDraft();
    fireEvent.click(screen.getByRole("button", { name: "Switch parent" }));
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    expect(screen.getByLabelText("Schedule item")).toHaveValue("");
    await user.type(screen.getByLabelText("Schedule item"), "Other arrival");
    fireEvent.click(screen.getByRole("button", { name: "Switch parent" }));
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(await screen.findByDisplayValue("Private arrival")).toBeVisible();
    expect(screen.queryByDisplayValue("Other arrival")).toBeNull();
  });

  it("retains the same command after a committed response is lost while away", async () => {
    const user = await enterDraft();
    const release = Promise.withResolvers<void>();
    const bodies: unknown[] = [];
    const ids: string[] = [];
    const replies = new Map<string, Response>();
    let first = true;
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      if (String(input).endsWith("/resources") && options?.method === "POST") {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        const response =
          replies.get(body.commandId)?.clone() ??
          (await store.fetch(input, options));
        expect(response.ok).toBe(true);
        replies.set(body.commandId, response.clone());
        ids.push((await response.clone().json()).resource.id);
        if (first) {
          first = false;
          await release.promise;
          throw new TypeError("Response lost");
        }
        return response;
      }
      return store.fetch(input, options);
    });
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    await waitFor(() => expect(ids).toHaveLength(1));
    navigateAway();
    await reopen(user);
    expect(screen.getByRole("dialog", { name: "Saving event" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume draft" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard draft" }),
    ).toBeDisabled();
    await act(async () => release.resolve());
    expect(
      await screen.findByRole("dialog", { name: "Resume your draft?" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "could not be confirmed",
    );
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(await screen.findByDisplayValue("Private arrival")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(ids[0]).toBe(ids[1]);
    const canonical = await (await store.fetch(`/api/events/${ids[0]}`)).json();
    expect(canonical).toMatchObject({
      version: 1,
      displayName: "Private arrival",
      permissionScopeId: eventId,
    });
    const calendar = await (
      await store.fetch(`/api/events/${eventId}/calendar`)
    ).json();
    expect(
      calendar.items.filter((item: { id: string }) => item.id === ids[0]),
    ).toHaveLength(1);
    expect(unloadIsPrevented()).toBe(false);
  });

  it("settles a pending save after navigation without a duplicate submission", async () => {
    const user = await enterDraft();
    const release = Promise.withResolvers<void>();
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      if (options?.method === "POST") await release.promise;
      return store.fetch(input, options);
    });
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    navigateAway();
    await reopen(user);
    expect(screen.getByRole("button", { name: "Resume draft" })).toBeDisabled();
    await act(async () => release.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetch).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    expect(screen.getByLabelText("Schedule item")).toHaveValue("");
    expect(unloadIsPrevented()).toBe(false);
  });

  it.each([401, 403, 404])(
    "clears recovery on parent access denial (%s)",
    async (status) => {
      const user = await enterDraft();
      navigateAway();
      await reopen(user);
      vi.mocked(fetch).mockResolvedValueOnce(failure(status));
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.queryByDisplayValue("Private arrival")).toBeNull();
      expect(unloadIsPrevented()).toBe(false);
    },
  );

  it("clears a draft when its parent becomes Viewer", async () => {
    const user = await enterDraft();
    navigateAway();
    await reopen(user);
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      const response = await store.fetch(input, options);
      return String(input).endsWith("/access")
        ? Response.json({ ...(await response.json()), actions: ["view"] })
        : response;
    });
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(unloadIsPrevented()).toBe(false);
  });

  it("retains fields after a temporary parent read failure for explicit retry", async () => {
    const user = await enterDraft();
    navigateAway();
    await reopen(user);
    vi.mocked(fetch).mockResolvedValueOnce(failure(500));
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByDisplayValue("Private arrival")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(await screen.findByDisplayValue("Private arrival")).toBeVisible();
  });

  it.each(["change", "discard"])(
    "starts a distinct command after %s instead of reusing a different create attempt",
    async (action) => {
      const user = await enterDraft();
      const commands: string[] = [];
      vi.mocked(fetch).mockImplementation(async (input, options) => {
        if (options?.method === "POST") {
          commands.push(JSON.parse(String(options.body)).commandId);
          if (commands.length === 1) return failure(500);
        }
        return store.fetch(input, options);
      });
      await user.click(screen.getByRole("button", { name: "Add to schedule" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      navigateAway();
      await reopen(user);
      if (action === "discard") {
        await user.click(screen.getByRole("button", { name: "Discard draft" }));
        await user.click(
          screen.getByRole("button", { name: "Add schedule item" }),
        );
        await user.type(
          screen.getByLabelText("Schedule item"),
          "Private arrival",
        );
      } else {
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        await user.type(
          await screen.findByLabelText("Schedule item"),
          " updated",
        );
      }
      await user.click(screen.getByRole("button", { name: "Add to schedule" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(commands).toHaveLength(2);
      expect(commands[0]).not.toBe(commands[1]);
    },
  );

  it.each(["Sign out", "Switch workspace"])(
    "clears retained and pending drafts on %s without late recovery",
    async (action) => {
      const user = await enterDraft();
      const release = Promise.withResolvers<void>();
      vi.mocked(fetch).mockImplementation(async (input, options) => {
        await release.promise;
        return store.fetch(input, options);
      });
      await user.click(screen.getByRole("button", { name: "Add to schedule" }));
      navigateAway();
      fireEvent.click(screen.getByRole("button", { name: action }));
      await act(async () => release.resolve());
      await reopen(user);
      expect(screen.getByLabelText("Schedule item")).toHaveValue("");
      expect(unloadIsPrevented()).toBe(false);
    },
  );
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
    await setDates(user, "2030-07-03");
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
    expect(dateRow(/^Dates/)).toHaveTextContent("Dates: Jul 3, 2030");
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

  it("sends a trimmed place from under Set dates and the calendar carries it", async () => {
    const request = vi.fn<typeof fetch>((input, options) =>
      store.fetch(input, options),
    );
    vi.stubGlobal("fetch", request);
    const user = await openEditor();
    await user.type(screen.getByLabelText("Schedule item"), "Lower loop");
    // The place row opens its text in place, with the hint as its placeholder.
    await user.click(screen.getByRole("button", { name: /^Add a place/ }));
    const place = screen.getByLabelText("Place");
    expect(place).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/The itinerary shows it beside the time/),
    );
    await user.type(place, "  Fushimi Inari Taisha, main gate  ");
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = request.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      resource: {
        objectType: "event",
        displayName: "Lower loop",
        location: "Fushimi Inari Taisha, main gate",
      },
    });
    const calendar = await (
      await store.fetch(`/api/events/${eventId}/calendar`)
    ).json();
    expect(
      calendar.items.find(
        (item: { displayName: string }) => item.displayName === "Lower loop",
      ),
    ).toMatchObject({ location: "Fushimi Inari Taisha, main gate" });
  });

  it("sends a trimmed description with its line breaks, and none for an empty one", async () => {
    const request = vi.fn<typeof fetch>((input, options) =>
      store.fetch(input, options),
    );
    vi.stubGlobal("fetch", request);
    const user = await openEditor();
    await user.type(screen.getByLabelText("Schedule item"), "Lower loop");
    const description = screen.getByLabelText("Description");
    expect(description).toHaveAttribute("placeholder", "Add a description");
    await user.type(
      description,
      "  Meet at the main gate.{Enter}Bring coins for the shrines.  ",
    );
    await user.click(screen.getByRole("button", { name: "Add to schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = request.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      resource: {
        objectType: "event",
        displayName: "Lower loop",
        description: "Meet at the main gate.\nBring coins for the shrines.",
      },
    });
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
      // Sign out ends the cookie session with one DELETE; the draft sends nothing.
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([, init]) => init?.method !== "DELETE"),
      ).toHaveLength(0);
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

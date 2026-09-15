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
import { eventResponseSchema } from "@chronelle/schemas";
import { useQuery } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { CreateEventDialog } from "../features/events/create-event-dialog";
import { EventInspector } from "../features/events/event-inspector";
import { useAuthSession } from "../lib/auth-session";
import { useApiClient } from "../lib/api-context";
import { queryKeys } from "../lib/queries";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let initial: ReturnType<typeof eventResponseSchema.parse>;
const onCreated = vi.fn();

function Harness() {
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const session = useAuthSession();
  const client = useApiClient();
  const event = useQuery({
    queryKey: queryKeys.eventResource(initial.id),
    initialData: initial,
    queryFn: () => client.getEvent(initial.id),
    enabled: false,
  });
  return (
    <>
      <button type="button" onClick={() => setEditor("create")}>
        New event
      </button>
      <button type="button" onClick={() => setEditor("edit")}>
        Edit event
      </button>
      <button type="button" onClick={() => setEditor(null)}>
        Navigate away
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
      {editor === "create" && (
        <CreateEventDialog
          onClose={() => setEditor(null)}
          onCreated={onCreated}
        />
      )}
      {editor === "edit" && (
        <EventInspector event={event.data} onClose={() => setEditor(null)} />
      )}
    </>
  );
}

function navigateAway() {
  fireEvent.click(screen.getByRole("button", { name: "Navigate away" }));
}

function unloadIsPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function errorResponse(status: number) {
  return Response.json(
    {
      error: {
        code: "request_failed",
        message: "Unavailable",
        requestId: "test",
      },
    },
    { status },
  );
}

beforeEach(async () => {
  onCreated.mockClear();
  let stored: string | null = null;
  store = new SandboxStore({
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  initial = eventResponseSchema.parse(
    await (
      await store.fetch("/api/events", {
        method: "POST",
        body: JSON.stringify({ displayName: "Garden evening" }),
      })
    ).json(),
  );
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, options) => store.fetch(input, options)),
  );
  for (const method of ["showModal", "close"] as const)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

async function edit(kind: "create" | "edit") {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <Providers>
        <Harness />
      </Providers>
    </StrictMode>,
  );
  await user.click(
    screen.getByRole("button", {
      name: kind === "create" ? "New event" : "Edit event",
    }),
  );
  await user.clear(
    screen.getByLabelText(kind === "create" ? "Event name" : "Name"),
  );
  await user.type(
    screen.getByLabelText(kind === "create" ? "Event name" : "Name"),
    "Private garden draft",
  );
  return user;
}

describe("Event draft recovery across navigation", () => {
  it.each(["create", "edit"] as const)(
    "recovers a %s draft only after a fresh access check",
    async (kind) => {
      const user = await edit(kind);
      const storage = window.sessionStorage.getItem("chronelle.session");
      navigateAway();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(unloadIsPrevented()).toBe(true);
      await user.click(
        screen.getByRole("button", {
          name: kind === "create" ? "New event" : "Edit event",
        }),
      );
      expect(
        screen.getByRole("dialog", { name: "Resume your draft?" }),
      ).toBeVisible();
      expect(
        screen.queryByDisplayValue("Private garden draft"),
      ).not.toBeInTheDocument();
      const completion = Promise.withResolvers<Response>();
      vi.mocked(fetch).mockImplementationOnce(() => completion.promise);
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      expect(
        screen.getByRole("button", { name: "Checking access..." }),
      ).toBeDisabled();
      expect(
        screen.queryByDisplayValue("Private garden draft"),
      ).not.toBeInTheDocument();
      const [input, options] = vi.mocked(fetch).mock.calls[0] ?? [];
      if (input === undefined)
        throw new Error("Expected a fresh access request");
      await act(async () =>
        completion.resolve(await store.fetch(input, options)),
      );
      expect(
        await screen.findByDisplayValue("Private garden draft"),
      ).toBeVisible();
      expect(window.sessionStorage.getItem("chronelle.session")).toBe(storage);
      expect(window.sessionStorage.length).toBe(1);
      if (kind === "edit")
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/objects/${initial.id}/access`),
          expect.anything(),
        );
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(unloadIsPrevented()).toBe(false);
    },
  );

  it("pins a recovered editor to its original version until latest is explicitly loaded", async () => {
    const user = await edit("edit");
    navigateAway();
    const changed = await store.fetch(`/api/events/${initial.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: 1,
        displayName: "Collaborator name",
      }),
    });
    expect(changed.status).toBe(200);
    await user.click(screen.getByRole("button", { name: "Edit event" }));
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(
      await screen.findByDisplayValue("Private garden draft"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Discard draft and load latest" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Collaborator name");
    expect(unloadIsPrevented()).toBe(false);
  });

  it.each([401, 403, 404])(
    "removes inaccessible recovery without rendering fields (%s)",
    async (status) => {
      const user = await edit("edit");
      navigateAway();
      await user.click(screen.getByRole("button", { name: "Edit event" }));
      vi.mocked(fetch).mockResolvedValueOnce(errorResponse(status));
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByDisplayValue("Private garden draft"),
      ).not.toBeInTheDocument();
      expect(unloadIsPrevented()).toBe(false);
      await user.click(screen.getByRole("button", { name: "Edit event" }));
      expect(screen.getByLabelText("Name")).toHaveValue(initial.displayName);
    },
  );

  it("forgets an edit draft when fresh access has become Viewer", async () => {
    const user = await edit("edit");
    navigateAway();
    await user.click(screen.getByRole("button", { name: "Edit event" }));
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      const response = await store.fetch(input, options);
      return String(input).endsWith("/access")
        ? Response.json({ ...(await response.json()), actions: ["view"] })
        : response;
    });
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(unloadIsPrevented()).toBe(false);
  });

  it("preserves a draft across a temporary access failure and retries only on request", async () => {
    const user = await edit("create");
    navigateAway();
    await user.click(screen.getByRole("button", { name: "New event" }));
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500));
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(fetch).toHaveBeenCalledOnce();
    expect(unloadIsPrevented()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(
      await screen.findByDisplayValue("Private garden draft"),
    ).toBeVisible();
  });

  it.each(["Sign out", "Switch workspace"])(
    "clears retained drafts and ignores late recovery after %s",
    async (action) => {
      const user = await edit("create");
      navigateAway();
      await user.click(screen.getByRole("button", { name: "New event" }));
      const completion = Promise.withResolvers<Response>();
      vi.mocked(fetch).mockImplementationOnce(() => completion.promise);
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      fireEvent.click(screen.getByRole("button", { name: action }));
      await act(async () =>
        completion.resolve(await store.fetch("/api/auth/session")),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(unloadIsPrevented()).toBe(false);
      await user.click(screen.getByRole("button", { name: "New event" }));
      expect(screen.getByLabelText("Event name")).toHaveValue("");
    },
  );

  it.each(["create", "edit"] as const)(
    "tracks a pending %s save after navigation without duplicate requests or late navigation",
    async (kind) => {
      const user = await edit(kind);
      const completion = Promise.withResolvers<Response>();
      vi.mocked(fetch).mockImplementationOnce(() => completion.promise);
      await user.click(
        screen.getByRole("button", {
          name: kind === "create" ? "Create event" : "Save event",
        }),
      );
      navigateAway();
      await user.click(
        screen.getByRole("button", {
          name: kind === "create" ? "New event" : "Edit event",
        }),
      );
      expect(
        screen.getByRole("dialog", { name: "Saving event" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Resume draft" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Discard draft" }),
      ).toBeDisabled();
      expect(fetch).toHaveBeenCalledOnce();
      const [input, options] = vi.mocked(fetch).mock.calls[0] ?? [];
      if (input === undefined) throw new Error("Expected a save request");
      await act(async () =>
        completion.resolve(await store.fetch(input, options)),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(onCreated).not.toHaveBeenCalled();
      expect(unloadIsPrevented()).toBe(false);
    },
  );

  it("keeps a failed unmounted save for recovery and explicit retry", async () => {
    const user = await edit("create");
    const completion = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => completion.promise);
    await user.click(screen.getByRole("button", { name: "Create event" }));
    navigateAway();
    await user.click(screen.getByRole("button", { name: "New event" }));
    await act(async () => completion.resolve(errorResponse(500)));
    expect(
      await screen.findByRole("dialog", { name: "Resume your draft?" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Check whether it was saved",
    );
    expect(fetch).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    expect(
      await screen.findByDisplayValue("Private garden draft"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(unloadIsPrevented()).toBe(false);
  });

  it("discards a recovery offer without a request and cannot reopen it from a late check", async () => {
    const user = await edit("edit");
    navigateAway();
    await user.click(screen.getByRole("button", { name: "Edit event" }));
    const completion = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => completion.promise);
    await user.click(screen.getByRole("button", { name: "Resume draft" }));
    await user.click(
      screen.getByRole("button", { name: "Close draft recovery" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit event" }));
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await act(async () => completion.resolve(Response.json(initial)));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(unloadIsPrevented()).toBe(false);
  });
});

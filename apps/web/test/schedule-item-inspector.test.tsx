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
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { ScheduleItemInspector } from "../features/events/schedule-item-inspector";
import { useEditorDraftStore } from "../lib/editor-draft-context";
import { readEventFields } from "../lib/editor-draft-store";
import { queryKeys } from "../lib/queries";
import { withCommands } from "./helpers/command-fetch";

const eventId = "019d6e7d-0000-7000-8000-000000000010";
const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const event = {
  id: eventId,
  workspaceId,
  permissionScopeId: eventId,
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  version: 1,
  displayName: "Garden welcome",
  objectType: "event" as const,
  startsAt: null,
  endsAt: null,
  startsOn: "2030-07-03",
  endsOn: "2030-07-05",
  timezone: "UTC",
  isAllDay: false,
  location: null,
  description: null,
};
const editorAccess = {
  resourceId: eventId,
  role: "owner",
  actions: ["view", "edit", "share", "delete"],
  source: { kind: "own" },
};

function Harness({
  open = true,
  onClose = () => {},
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const queries = useQueryClient();
  const drafts = useEditorDraftStore();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          queries.setQueryData(queryKeys.eventResource(eventId), event);
          queries.setQueryData(queryKeys.access(eventId), editorAccess);
        }}
      >
        Cache editor access
      </button>
      <button
        type="button"
        onClick={() => {
          const baseline = readEventFields(event);
          drafts.keep(eventId, {
            kind: "event",
            source: event,
            baseline,
            fields: { ...baseline, displayName: "Kept welcome" },
          });
        }}
      >
        Keep draft
      </button>
      <button
        type="button"
        onClick={() =>
          void queries.invalidateQueries({ queryKey: queryKeys.event(eventId) })
        }
      >
        Refresh item
      </button>
      {open && <ScheduleItemInspector eventId={eventId} onClose={onClose} />}
    </>
  );
}

describe("schedule item inspector", () => {
  beforeEach(() => {
    for (const method of ["showModal", "close"] as const) {
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.toggleAttribute("open", method === "showModal");
        },
      });
    }
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("waits for fresh item access instead of trusting cached parent-era access", async () => {
    const access = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).endsWith("/access") ? access.promise : Response.json(event),
    );
    vi.stubGlobal("fetch", fetch);
    const view = render(<Harness open={false} />, { wrapper: Providers });
    fireEvent.click(screen.getByText("Cache editor access"));
    view.rerender(<Harness />);
    expect(screen.queryByLabelText("Name")).toBeNull();
    await act(() =>
      access.resolve(
        Response.json({ ...editorAccess, role: "viewer", actions: ["view"] }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer available to edit",
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(fetch.mock.calls.map(([url]) => String(url))).toContainEqual(
      expect.stringContaining(`/events/${eventId}`),
    );
  });

  it("offers the Place field and saves it with the schedule", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      withCommands(async (input, options) => {
        if (options?.method === "PATCH") {
          const body = JSON.parse(String(options.body));
          patches.push(body);
          const { expectedVersion: _expected, ...changes } = body;
          return Response.json({
            ...event,
            ...changes,
            version: event.version + 1,
          });
        }
        return Response.json(
          String(input).endsWith("/access") ? editorAccess : event,
        );
      }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ScheduleItemInspector eventId={eventId} onClose={onClose} />, {
      wrapper: Providers,
    });
    await user.click(
      await screen.findByRole("button", { name: /^Add a place/ }),
    );
    const place = screen.getByLabelText("Place");
    expect(place).toHaveValue("");
    await user.type(place, " Camellia Flower, Ninenzaka ");
    await user.click(screen.getByRole("button", { name: "Save event" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([
      expect.objectContaining({
        expectedVersion: event.version,
        location: "Camellia Flower, Ninenzaka",
      }),
    ]);
  });

  it("offers the Description field, prefilled, and saves a trimmed one", async () => {
    const patches: unknown[] = [];
    const described = { ...event, description: "Meet at the main gate." };
    vi.stubGlobal(
      "fetch",
      withCommands(async (input, options) => {
        if (options?.method === "PATCH") {
          const body = JSON.parse(String(options.body));
          patches.push(body);
          const { expectedVersion: _expected, ...changes } = body;
          return Response.json({
            ...described,
            ...changes,
            version: described.version + 1,
          });
        }
        return Response.json(
          String(input).endsWith("/access") ? editorAccess : described,
        );
      }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ScheduleItemInspector eventId={eventId} onClose={onClose} />, {
      wrapper: Providers,
    });
    const description = await screen.findByLabelText("Description");
    expect(description).toHaveValue("Meet at the main gate.");
    await user.clear(description);
    await user.type(description, "  Meet at the side gate.  ");
    await user.click(screen.getByRole("button", { name: "Save event" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([
      expect.objectContaining({
        expectedVersion: described.version,
        description: "Meet at the side gate.",
      }),
    ]);
  });

  it("keeps fields and their original version when closing is cancelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) =>
        Response.json(String(input).endsWith("/access") ? editorAccess : event),
      ),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ScheduleItemInspector eventId={eventId} onClose={onClose} />, {
      wrapper: Providers,
    });
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Unsaved welcome" } });
    name.focus();
    fireEvent(
      screen.getByRole("dialog", { name: "Edit schedule item" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(
      screen.getByRole("dialog", { name: "Discard changes?" }),
    ).toBeVisible();
    expect(name).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(name).toHaveValue("Unsaved welcome");
    expect(name).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks a recovered draft against a newer canonical item", async () => {
    const latest = { ...event, version: 2, displayName: "Changed elsewhere" };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) =>
        Response.json(
          String(input).endsWith("/access") ? editorAccess : latest,
        ),
      ),
    );
    const user = userEvent.setup();
    const view = render(<Harness open={false} />, { wrapper: Providers });
    fireEvent.click(screen.getByText("Keep draft"));
    view.rerender(<Harness />);
    await user.click(
      await screen.findByRole("button", { name: "Resume draft" }),
    );
    expect(await screen.findByLabelText("Name")).toHaveValue("Kept welcome");
    expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Take theirs" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Changed elsewhere");
    expect(screen.getByRole("button", { name: "Save event" })).toBeEnabled();
  });

  it.each([403, 404])(
    "removes retained values after a definitive %i response",
    async (status) => {
      let denied = true;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async (input) =>
          denied
            ? Response.json(
                { error: { code: "not_found", message: "Unavailable" } },
                { status },
              )
            : Response.json(
                String(input).endsWith("/access") ? editorAccess : event,
              ),
        ),
      );
      const view = render(<Harness open={false} />, { wrapper: Providers });
      fireEvent.click(screen.getByText("Keep draft"));
      view.rerender(<Harness />);
      await screen.findByRole("alert", {}, { timeout: 3000 });
      view.rerender(<Harness open={false} />);
      denied = false;
      view.rerender(<Harness />);
      expect(await screen.findByLabelText("Name")).toHaveValue(
        event.displayName,
      );
      expect(screen.queryByRole("button", { name: "Resume draft" })).toBeNull();
    },
  );

  it("retains fields after a temporary refresh error and rechecks before recovery", async () => {
    let failing = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input) =>
        failing
          ? Response.json(
              { error: { code: "unavailable", message: "Try later" } },
              { status: 503 },
            )
          : Response.json(
              String(input).endsWith("/access") ? editorAccess : event,
            ),
      ),
    );
    render(<Harness />, { wrapper: Providers });
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Temporary draft" },
    });
    failing = true;
    fireEvent.click(screen.getByText("Refresh item"));
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull(), {
      timeout: 3000,
    });
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume draft" }),
    );
    expect(await screen.findByLabelText("Name")).toHaveValue("Temporary draft");
  });
});

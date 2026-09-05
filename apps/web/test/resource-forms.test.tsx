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
import {
  EventEditorForm,
  ExpenseForm,
  ReminderForm,
  ScheduledEventForm,
  TaskForm,
} from "../features/events/resource-forms";

const objectId = "019d6e7d-0000-7000-8000-000000000010";
const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const common = {
  id: objectId,
  workspaceId,
  permissionScopeId: objectId,
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
};
const eventResource = (version: number, displayName: string) => ({
  ...common,
  version,
  displayName,
  objectType: "event" as const,
  startsAt: "2026-10-15T17:00:00.000Z",
  endsAt: null,
  timezone: "UTC",
  isAllDay: false,
});

const forms = [
  {
    name: "event",
    field: "Name",
    render: (version: number, displayName: string) => (
      <EventEditorForm event={eventResource(version, displayName)} />
    ),
  },
  {
    name: "schedule",
    field: "Schedule item",
    render: (version: number, displayName: string) => (
      <ScheduledEventForm
        eventId={objectId}
        event={eventResource(version, displayName)}
      />
    ),
  },
  {
    name: "task",
    field: "Task",
    render: (version: number, displayName: string) => (
      <TaskForm
        eventId={objectId}
        task={{
          ...common,
          version,
          displayName,
          objectType: "task",
          status: "todo",
          dueAt: null,
          completedAt: null,
        }}
      />
    ),
  },
  {
    name: "expense",
    field: "Expense",
    render: (version: number, displayName: string) => (
      <ExpenseForm
        eventId={objectId}
        expense={{
          ...common,
          version,
          displayName,
          objectType: "expense",
          amount: "25.0000",
          currency: "USD",
          occurredAt: "2026-09-02T20:00:00.000Z",
        }}
      />
    ),
  },
  {
    name: "reminder",
    field: "Reminder",
    render: (version: number, displayName: string) => (
      <ReminderForm
        eventId={objectId}
        reminder={{
          ...common,
          version,
          displayName,
          objectType: "reminder",
          status: "pending",
          remindAt: "2026-10-15T16:00:00.000Z",
        }}
      />
    ),
  },
];

describe("versioned editor drafts", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it.each(forms)(
    "preserves the $name draft until an explicit reload",
    async (form) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      const user = userEvent.setup();
      const view = render(form.render(1, "Initial title"), {
        wrapper: Providers,
      });
      fireEvent.change(screen.getByLabelText(form.field), {
        target: { value: "My unsaved draft" },
      });

      view.rerender(form.render(2, "Collaborator update"));
      expect(screen.getByLabelText(form.field)).toHaveValue("My unsaved draft");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your draft is preserved",
      );
      const submit = view.container.querySelector("button[type=submit]");
      expect(submit).toBeDisabled();
      const element = view.container.querySelector("form");
      if (element === null) throw new Error("Editor form not found.");
      fireEvent.submit(element);
      expect(fetch).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole("button", { name: "Discard draft and load latest" }),
      );
      expect(screen.getByLabelText(form.field)).toHaveValue(
        "Collaborator update",
      );
      expect(submit).toBeEnabled();
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  it("disables inputs and duplicate submissions while saving", async () => {
    let finishSave: ((response: Response) => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          finishSave = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const view = render(
      <EventEditorForm event={eventResource(1, "Initial")} />,
      { wrapper: Providers },
    );
    await user.click(screen.getByRole("button", { name: "Save event" }));
    for (const input of view.container.querySelectorAll("input"))
      expect(input).toBeDisabled();
    const form = view.container.querySelector("form");
    if (form === null || finishSave === undefined)
      throw new Error("Save was not started.");
    fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => finishSave?.(Response.json(eventResource(2, "Initial"))));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
  });

  it("retains the draft after a server-side version conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () =>
        Response.json(
          {
            error: {
              code: "version_conflict",
              message: "This object was updated by another request.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<EventEditorForm event={eventResource(1, "Initial")} />, {
      wrapper: Providers,
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "My draft" },
    });
    await user.click(screen.getByRole("button", { name: "Save event" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("My draft");
  });

  it("uses the accepted save version for the next edit without a parent rerender", async () => {
    const versions: number[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        displayName: string;
        expectedVersion: number;
      };
      versions.push(body.expectedVersion);
      return Response.json(
        eventResource(body.expectedVersion + 1, body.displayName),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<EventEditorForm event={eventResource(1, "Initial")} />, {
      wrapper: Providers,
    });
    for (const title of ["First edit", "Second edit"]) {
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: title },
      });
      await user.click(screen.getByRole("button", { name: "Save event" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Save event" }),
        ).toBeEnabled(),
      );
    }
    expect(versions).toEqual([1, 2]);
  });
});

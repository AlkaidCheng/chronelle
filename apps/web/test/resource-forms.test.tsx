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
  startsOn: null,
  endsOn: null,
  isAllDay: false,
});

const taskResource = (version: number, displayName: string) =>
  ({
    ...common,
    version,
    displayName,
    objectType: "task",
    status: "todo",
    dueAt: null,
    completedAt: null,
  }) as const;

const expenseResource = (version: number, displayName: string) =>
  ({
    ...common,
    version,
    displayName,
    objectType: "expense",
    amount: "25.0000",
    currency: "USD",
    occurredAt: "2026-09-02T20:00:00.000Z",
  }) as const;

const reminderResource = (version: number, displayName: string) =>
  ({
    ...common,
    version,
    displayName,
    objectType: "reminder",
    status: "pending",
    remindAt: "2026-10-15T16:00:00.000Z",
  }) as const;

const forms = [
  {
    name: "event",
    resource: eventResource,
    field: "Name",
    render: (version: number, displayName: string) => (
      <EventEditorForm event={eventResource(version, displayName)} />
    ),
  },
  {
    name: "schedule",
    resource: eventResource,
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
    resource: taskResource,
    field: "Task",
    render: (version: number, displayName: string) => (
      <TaskForm eventId={objectId} task={taskResource(version, displayName)} />
    ),
  },
  {
    name: "expense",
    resource: expenseResource,
    field: "Expense",
    render: (version: number, displayName: string) => (
      <ExpenseForm
        eventId={objectId}
        expense={expenseResource(version, displayName)}
      />
    ),
  },
  {
    name: "reminder",
    resource: reminderResource,
    field: "Reminder",
    render: (version: number, displayName: string) => (
      <ReminderForm
        eventId={objectId}
        reminder={reminderResource(version, displayName)}
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

  it.each(["event", "schedule"])(
    "clears %s validation when dates are turned off",
    async (kind) => {
      const user = userEvent.setup();
      const event = { ...eventResource(1, "Plan"), startsAt: null };
      const view = render(
        kind === "event" ? (
          <EventEditorForm event={event} />
        ) : (
          <ScheduledEventForm eventId={objectId} event={event} />
        ),
        { wrapper: Providers },
      );
      await user.click(screen.getByRole("switch", { name: "Set dates" }));
      const form = view.container.querySelector("form");
      if (form === null) throw new Error("Editor form not found.");
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Choose a start date.",
      );
      await user.click(screen.getByRole("switch", { name: "Set dates" }));
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("clears a recorded expense while keeping its currency and date for another entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const { resource } = JSON.parse(String(init?.body)) as {
          resource: {
            displayName: string;
            amount: string;
            currency: string;
            occurredAt: string;
          };
        };
        return Response.json({
          resource: {
            ...expenseResource(1, resource.displayName),
            ...resource,
          },
          relationId: "019d6e7d-0000-7000-8000-000000000020",
        });
      }),
    );
    const user = userEvent.setup();
    render(<ExpenseForm eventId={objectId} />, { wrapper: Providers });
    fireEvent.change(screen.getByLabelText("Expense"), {
      target: { value: "Venue" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "12.3400" },
    });
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "EUR" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-10-15T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Record expense" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Expense")).toHaveValue(""),
    );
    expect(screen.getByLabelText("Amount")).toHaveValue("");
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-15T10:00");
    expect(
      screen.getByRole("button", { name: "Record expense" }),
    ).toBeEnabled();
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
      expect(screen.getByText(/Your draft is preserved/)).toBeVisible();
      const submit = view.container.querySelector("button[type=submit]");
      expect(submit).toBeDisabled();
      screen.getByLabelText(form.field).focus();
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(fetch).not.toHaveBeenCalled();
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
      expect(screen.queryByText(/Your draft is preserved/)).toBeNull();
    },
  );

  it.each(forms)(
    "disables $name inputs and duplicate submissions while saving",
    async (editor) => {
      let finishSave: ((response: Response) => void) | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(
        () =>
          new Promise<Response>((resolve) => {
            finishSave = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const user = userEvent.setup();
      const view = render(editor.render(1, "Initial"), { wrapper: Providers });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      screen.getByLabelText(editor.field).focus();
      await user.keyboard("{Control>}{Enter}{/Control}");
      for (const input of view.container.querySelectorAll("input"))
        expect(input).toBeDisabled();
      const form = view.container.querySelector("form");
      if (form === null || finishSave === undefined)
        throw new Error("Save was not started.");
      fireEvent.submit(form);
      fireEvent.keyDown(screen.getByLabelText(editor.field), {
        key: "Enter",
        ctrlKey: true,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(form).toHaveAttribute("aria-busy", "true");
      expect(
        screen.getByRole("status", { name: "Save status" }),
      ).toHaveTextContent("Saving changes...");
      await act(() =>
        finishSave?.(
          Response.json(
            {
              error: { code: "version_conflict", message: "Changed elsewhere" },
            },
            { status: 409 },
          ),
        ),
      );
      await waitFor(() =>
        expect(screen.getByLabelText(editor.field)).toBeEnabled(),
      );
      expect(form).toHaveAttribute("aria-busy", "false");
    },
  );

  it.each(forms)(
    "retains the $name draft after a server-side version conflict",
    async (form) => {
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
      const view = render(form.render(1, "Initial"), {
        wrapper: Providers,
      });
      fireEvent.change(screen.getByLabelText(form.field), {
        target: { value: "My draft" },
      });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      await user.click(submit);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "A newer version is available",
      );
      expect(screen.getByLabelText(form.field)).toHaveValue("My draft");
      await user.click(screen.getByRole("button", { name: "Refresh latest" }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(screen.getByLabelText(form.field)).toHaveValue("My draft");
      view.rerender(form.render(2, "Saved elsewhere"));
      await user.click(
        screen.getByRole("button", { name: "Discard draft and load latest" }),
      );
      expect(screen.getByLabelText(form.field)).toHaveValue("Saved elsewhere");
      expect(submit).toBeEnabled();
    },
  );

  it.each(
    forms.flatMap((form) =>
      ["button", "shortcut"].map((method) => ({ ...form, method })),
    ),
  )(
    "uses the accepted $name save version through $method without a parent rerender",
    async (form) => {
      const versions: number[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          displayName: string;
          expectedVersion: number;
        };
        versions.push(body.expectedVersion);
        return Response.json(
          form.resource(body.expectedVersion + 1, body.displayName),
        );
      });
      vi.stubGlobal("fetch", fetch);
      const user = userEvent.setup();
      const view = render(form.render(1, "Initial"), {
        wrapper: Providers,
      });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      for (const title of ["First edit", "Second edit"]) {
        fireEvent.change(screen.getByLabelText(form.field), {
          target: { value: title },
        });
        expect(
          screen.getByRole("status", { name: "Save status" }),
        ).toBeEmptyDOMElement();
        if (form.method === "button") await user.click(submit);
        else {
          screen.getByLabelText(form.field).focus();
          await user.keyboard("{Meta>}{Enter}{/Meta}");
        }
        await waitFor(() => expect(submit).toBeEnabled());
        expect(
          screen.getByRole("status", { name: "Save status" }),
        ).toHaveTextContent("Saved successfully.");
      }
      expect(versions).toEqual([1, 2]);
    },
  );
});

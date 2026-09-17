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
import {
  eventResponseSchema,
  taskResponseSchema,
  expenseResponseSchema,
  reminderResponseSchema,
  type ReminderResponse,
  type ExpenseResponse,
  type TaskResponse,
} from "@chronelle/schemas";
import { StrictMode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { TaskForm } from "../features/events/task-form";
import { TaskInspector } from "../features/events/task-inspector";
import { ExpenseForm } from "../features/events/expense-form";
import { ExpenseInspector } from "../features/events/expense-inspector";
import { ReminderForm } from "../features/events/reminder-form";
import { ReminderInspector } from "../features/events/reminder-inspector";
import { useAuthSession } from "../lib/auth-session";
import { describeDueDay } from "../lib/due-choices";
import { useApiClient } from "../lib/api-context";
import { queryKeys } from "../lib/queries";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const draftKinds = ["task", "expense", "reminder"] as const;
describe.each(draftKinds)("%s draft recovery", (kind) => {
  const { field, timeLabel, createLabel, schema, Form } = {
    task: {
      field: "Task",
      timeLabel: "Due date",
      createLabel: "Create task",
      schema: taskResponseSchema,
      Form: TaskForm,
    },
    expense: {
      field: "Expense",
      timeLabel: "Date",
      createLabel: "Record expense",
      schema: expenseResponseSchema,
      Form: ExpenseForm,
    },
    reminder: {
      field: "Reminder",
      timeLabel: "Reminder time",
      createLabel: "Record reminder",
      schema: reminderResponseSchema,
      Form: ReminderForm,
    },
  }[kind];
  const saveLabel = `Save ${kind}`;
  const originalTime = "2030-07-03T18:30:45.678Z";
  let store: SandboxStore;
  let eventId: string;
  let otherEventId: string;
  let resource: TaskResponse | ExpenseResponse | ReminderResponse;
  type Mode = "create" | "edit";

  function Harness() {
    const session = useAuthSession();
    const [editor, setEditor] = useState<{
      mode: Mode;
      parent: string;
    } | null>(null);
    return (
      <>
        {(["create", "edit"] as const).flatMap((mode) =>
          [eventId, otherEventId].map((parent) => (
            <button
              key={`${mode}:${parent}`}
              type="button"
              onClick={() => setEditor({ mode, parent })}
            >
              {`${mode} ${parent === eventId ? "here" : "elsewhere"}`}
            </button>
          )),
        )}
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
        {editor?.mode === "create" && (
          <Form eventId={editor.parent} onCancel={() => setEditor(null)} />
        )}
        {editor?.mode === "edit" &&
          (kind === "task" ? (
            <TaskInspector
              eventId={editor.parent}
              taskId={resource.id}
              onClose={() => setEditor(null)}
            />
          ) : kind === "expense" ? (
            <ExpenseInspector
              eventId={editor.parent}
              expenseId={resource.id}
              onClose={() => setEditor(null)}
            />
          ) : (
            <ReminderInspector
              eventId={editor.parent}
              reminderId={resource.id}
              onClose={() => setEditor(null)}
            />
          ))}
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

  function failure(status: number) {
    return Response.json(
      { error: { code: "unavailable", message: "Unavailable" } },
      { status },
    );
  }

  function AccessObserver({ id }: { readonly id: string }) {
    const client = useApiClient();
    const access = useQuery({
      queryKey: queryKeys.access(id),
      queryFn: () => client.getObjectAccess(id),
    });
    return <span>{access.isSuccess ? "Access ready" : "Checking access"}</span>;
  }

  async function begin(mode: Mode, observeAccess = false) {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Providers>
          {observeAccess && (
            <AccessObserver id={mode === "create" ? eventId : resource.id} />
          )}
          <Harness />
        </Providers>
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: `${mode} here` }));
    const name = await screen.findByLabelText(field);
    await user.clear(name);
    await user.type(name, "Pack the lanterns");
    if (mode === "create" && kind === "expense")
      fireEvent.change(screen.getByLabelText("Amount"), {
        target: { value: "-12.3400" },
      });
    if (mode === "create" && kind === "reminder")
      fireEvent.change(screen.getByLabelText(timeLabel), {
        target: { value: "2030-07-03T11:30" },
      });
    return user;
  }

  async function reopen(
    user: ReturnType<typeof userEvent.setup>,
    mode: Mode,
    elsewhere = false,
  ) {
    await user.click(
      screen.getByRole("button", {
        name: `${mode} ${elsewhere ? "elsewhere" : "here"}`,
      }),
    );
    await screen.findByRole("dialog", { name: "Resume your draft?" });
  }

  function saveRequests() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([, options]) =>
        ["POST", "PATCH"].includes(options?.method ?? ""),
      );
  }

  beforeEach(async () => {
    let stored: string | null = null;
    store = new SandboxStore({
      getItem: () => stored,
      setItem: (_key, value) => {
        stored = value;
      },
    });
    async function createEvent(displayName: string) {
      return eventResponseSchema.parse(
        await (
          await store.fetch("/api/events", {
            method: "POST",
            body: JSON.stringify({ displayName }),
          })
        ).json(),
      ).id;
    }
    eventId = await createEvent("Garden evening");
    otherEventId = await createEvent("Summer festival");
    resource = schema.parse(
      (
        await (
          await store.fetch(`/api/events/${eventId}/resources`, {
            method: "POST",
            body: JSON.stringify({
              commandId: crypto.randomUUID(),
              resource: {
                objectType: kind,
                displayName: "Pack supplies",
                ...(kind === "task"
                  ? { dueAt: originalTime }
                  : kind === "reminder"
                    ? { remindAt: originalTime }
                    : {
                        amount: "-12.3400",
                        currency: "USD",
                        occurredAt: originalTime,
                      }),
              },
            }),
          })
        ).json()
      ).resource,
    );
    sessionStorage.setItem(
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
    sessionStorage.clear();
  });

  describe("retention lifecycle", () => {
    it.each(["create", "edit"] as const)(
      "settles a confirmed %s without waiting for an access refresh",
      async (mode) => {
        const user = await begin(mode, true);
        await screen.findByText("Access ready");
        const refresh = Promise.withResolvers<Response>();
        vi.mocked(fetch).mockImplementation((input, options) =>
          String(input).endsWith("/access")
            ? refresh.promise
            : store.fetch(input, options),
        );
        await user.click(
          screen.getByRole("button", {
            name: mode === "create" ? createLabel : saveLabel,
          }),
        );
        try {
          await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
          expect(unloadIsPrevented()).toBe(false);
          expect(saveRequests()).toHaveLength(1);
        } finally {
          await act(async () =>
            refresh.resolve(
              Response.json({
                resourceId: mode === "create" ? eventId : resource.id,
                actions: ["view", "edit"],
                source: { kind: "own" },
              }),
            ),
          );
        }
      },
    );
    it.each(["create", "edit"] as const)(
      "checks fresh access before resuming a %s draft",
      async (mode) => {
        const user = await begin(mode);
        // The task's due sits behind its disclosure.
        if (kind === "task") await user.click(screen.getByText(/^Due: /));
        const due = screen.getByLabelText(timeLabel);
        const edited = kind === "task" ? "2030-07-04" : "2030-07-04T10:15";
        fireEvent.change(due, { target: { value: edited } });
        const session = sessionStorage.getItem("chronelle.session");
        navigateAway();
        expect(unloadIsPrevented()).toBe(true);
        await reopen(user, mode);
        expect(screen.queryByDisplayValue("Pack the lanterns")).toBeNull();
        vi.mocked(fetch).mockClear();
        const deferred = Promise.withResolvers<Response>();
        vi.mocked(fetch).mockImplementationOnce(() => deferred.promise);
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        expect(
          screen.getByRole("button", { name: "Checking access..." }),
        ).toBeDisabled();
        expect(screen.queryByLabelText(field)).toBeNull();
        const [input, options] = vi.mocked(fetch).mock.calls[0] ?? [];
        if (!input) throw new Error("Expected a fresh resource read");
        await act(async () =>
          deferred.resolve(await store.fetch(input, options)),
        );
        expect(await screen.findByLabelText(field)).toHaveValue(
          "Pack the lanterns",
        );
        expect(screen.getByLabelText(field)).toHaveFocus();
        if (kind === "task")
          expect(screen.getByText(/^Due: /)).toHaveTextContent(
            `Due: ${describeDueDay(edited, new Date())}`,
          );
        else expect(screen.getByLabelText(timeLabel)).toHaveValue(edited);
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining(
            `/objects/${mode === "create" ? eventId : resource.id}/access`,
          ),
          expect.anything(),
        );
        expect(sessionStorage.length).toBe(1);
        expect(sessionStorage.getItem("chronelle.session")).toBe(session);
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await user.click(screen.getByRole("button", { name: "Discard" }));
        expect(unloadIsPrevented()).toBe(false);
        expect(saveRequests()).toHaveLength(0);
      },
    );

    it("shares a canonical edit draft across event contexts and preserves its source timestamp", async () => {
      const user = await begin("edit");
      navigateAway();
      await reopen(user, "edit", true);
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      expect(await screen.findByLabelText(field)).toHaveValue(
        "Pack the lanterns",
      );
      await user.click(screen.getByRole("button", { name: saveLabel }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const saved = schema.parse(
        await (await store.fetch(`/api/${kind}s/${resource.id}`)).json(),
      );
      expect(saved).toMatchObject({
        id: resource.id,
        version: 2,
        ...(kind === "task"
          ? { dueAt: originalTime }
          : kind === "reminder"
            ? { remindAt: originalTime }
            : {
                occurredAt: originalTime,
                amount: "-12.3400",
                currency: "USD",
              }),
        displayName: "Pack the lanterns",
      });
    });

    it("isolates creation drafts by parent event", async () => {
      const user = await begin("create");
      navigateAway();
      await user.click(
        screen.getByRole("button", { name: "create elsewhere" }),
      );
      expect(await screen.findByLabelText(field)).toHaveValue("");
      await user.type(screen.getByLabelText(field), "Book the musicians");
      navigateAway();
      await reopen(user, "create");
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      expect(await screen.findByLabelText(field)).toHaveValue(
        "Pack the lanterns",
      );
      navigateAway();
      await reopen(user, "create", true);
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      expect(await screen.findByLabelText(field)).toHaveValue(
        "Book the musicians",
      );
      expect(saveRequests()).toHaveLength(0);
    });

    it("keeps the original version until newer canonical fields are explicitly loaded", async () => {
      const user = await begin("edit");
      navigateAway();
      expect(
        (
          await store.fetch(`/api/${kind}s/${resource.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion: resource.version,
              displayName: "Collaborator plan",
            }),
          })
        ).status,
      ).toBe(200);
      await reopen(user, "edit");
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      expect(await screen.findByLabelText(field)).toHaveValue(
        "Pack the lanterns",
      );
      expect(screen.getByRole("button", { name: saveLabel })).toBeDisabled();
      await user.click(
        screen.getByRole("button", { name: "Discard draft and load latest" }),
      );
      expect(screen.getByLabelText(field)).toHaveValue("Collaborator plan");
      expect(unloadIsPrevented()).toBe(false);
      expect(saveRequests()).toHaveLength(0);
    });

    it.each(["create", "edit"] as const)(
      "preserves a %s draft through temporary access failure",
      async (mode) => {
        const user = await begin(mode);
        navigateAway();
        await reopen(user, mode);
        vi.mocked(fetch).mockClear();
        vi.mocked(fetch).mockResolvedValueOnce(failure(503));
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(unloadIsPrevented()).toBe(true);
        expect(screen.queryByLabelText(field)).toBeNull();
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        expect(await screen.findByLabelText(field)).toHaveValue(
          "Pack the lanterns",
        );
      },
    );

    it.each(["create", "edit"] as const)(
      "forgets a %s recovery offer when access becomes Viewer",
      async (mode) => {
        const user = await begin(mode);
        navigateAway();
        await reopen(user, mode);
        vi.mocked(fetch).mockImplementation(async (input, options) =>
          String(input).endsWith("/access")
            ? Response.json({
                resourceId: mode === "create" ? eventId : resource.id,
                actions: ["view"],
                source: { kind: "own" },
              })
            : store.fetch(input, options),
        );
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        await waitFor(() => expect(unloadIsPrevented()).toBe(false));
        expect(screen.queryByLabelText(field)).toBeNull();
        expect(screen.queryByDisplayValue("Pack the lanterns")).toBeNull();
      },
    );

    it.each([401, 403, 404])(
      "forgets a creation draft after definitive parent denial (%s)",
      async (status) => {
        const user = await begin("create");
        navigateAway();
        await reopen(user, "create");
        vi.mocked(fetch).mockResolvedValueOnce(failure(status));
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(unloadIsPrevented()).toBe(false);
        await user.click(screen.getByRole("button", { name: "create here" }));
        expect(await screen.findByLabelText(field)).toHaveValue("");
      },
    );

    it.each([401, 403, 404])(
      "forgets a retained edit after fresh canonical denial (%s)",
      async (status) => {
        const user = await begin("edit");
        navigateAway();
        vi.mocked(fetch).mockImplementation(async () => failure(status));
        await user.click(screen.getByRole("button", { name: "edit here" }));
        expect(screen.queryByDisplayValue("Pack the lanterns")).toBeNull();
        // The application retries failed reads after one second.
        expect(
          await screen.findByRole("alert", {}, { timeout: 3_000 }),
        ).toHaveTextContent("no longer available");
        expect(screen.queryByDisplayValue("Pack the lanterns")).toBeNull();
        await waitFor(() => expect(unloadIsPrevented()).toBe(false));
        navigateAway();
        vi.mocked(fetch).mockImplementation((input, options) =>
          store.fetch(input, options),
        );
        await user.click(screen.getByRole("button", { name: "edit here" }));
        expect(await screen.findByLabelText(field)).toHaveValue(
          resource.displayName,
        );
      },
    );

    it("retains an edit that fails after navigation until an explicit retry", async () => {
      const user = await begin("edit");
      const deferred = Promise.withResolvers<Response>();
      vi.mocked(fetch).mockImplementationOnce(() => deferred.promise);
      await user.click(screen.getByRole("button", { name: saveLabel }));
      navigateAway();
      await act(async () => deferred.resolve(failure(503)));
      await reopen(user, "edit");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Check whether it was saved",
      );
      expect(saveRequests()).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "Resume draft" }));
      expect(await screen.findByLabelText(field)).toHaveValue(
        "Pack the lanterns",
      );
      await user.click(screen.getByRole("button", { name: saveLabel }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(saveRequests()).toHaveLength(2);
      expect(unloadIsPrevented()).toBe(false);
    });

    it.each(["create", "edit"] as const)(
      "settles a pending %s after navigation without another write",
      async (mode) => {
        const user = await begin(mode);
        const deferred = Promise.withResolvers<Response>();
        vi.mocked(fetch).mockImplementationOnce(() => deferred.promise);
        await user.click(
          screen.getByRole("button", {
            name: mode === "create" ? createLabel : saveLabel,
          }),
        );
        const [input, options] = saveRequests()[0] ?? [];
        if (!input) throw new Error("Expected a save request");
        navigateAway();
        await user.click(screen.getByRole("button", { name: `${mode} here` }));
        expect(
          await screen.findByRole("dialog", { name: `Saving ${kind}` }),
        ).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Resume draft" }),
        ).toBeDisabled();
        expect(
          screen.getByRole("button", { name: "Discard draft" }),
        ).toBeDisabled();
        expect(saveRequests()).toHaveLength(1);
        await act(async () =>
          deferred.resolve(await store.fetch(input, options)),
        );
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(unloadIsPrevented()).toBe(false);
        expect(saveRequests()).toHaveLength(1);
      },
    );

    it.each([false, true])(
      "retains the failed creation receipt and changes it only with edited fields (%s)",
      async (changeFields) => {
        const user = await begin("create");
        const deferred = Promise.withResolvers<Response>();
        vi.mocked(fetch).mockImplementationOnce(() => deferred.promise);
        await user.click(screen.getByRole("button", { name: createLabel }));
        navigateAway();
        await act(async () => deferred.resolve(failure(503)));
        await reopen(user, "create");
        expect(screen.getByRole("status")).toHaveTextContent(
          "could not be confirmed",
        );
        await user.click(screen.getByRole("button", { name: "Resume draft" }));
        expect(await screen.findByLabelText(field)).toHaveValue(
          "Pack the lanterns",
        );
        if (changeFields)
          await user.type(screen.getByLabelText(field), " tomorrow");
        await user.click(screen.getByRole("button", { name: createLabel }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        const requests = saveRequests().map(
          ([, options]) =>
            JSON.parse(String(options?.body)) as { commandId: string },
        );
        expect(requests).toHaveLength(2);
        expect(requests[0]?.commandId === requests[1]?.commandId).toBe(
          !changeFields,
        );
        expect(unloadIsPrevented()).toBe(false);
      },
    );

    it.each(["Sign out", "Switch workspace"])(
      "ignores pending save failures after %s",
      async (action) => {
        const user = await begin("create");
        const deferred = Promise.withResolvers<Response>();
        vi.mocked(fetch).mockImplementationOnce(() => deferred.promise);
        await user.click(screen.getByRole("button", { name: createLabel }));
        fireEvent.click(screen.getByRole("button", { name: action }));
        await act(async () => deferred.resolve(failure(503)));
        expect(unloadIsPrevented()).toBe(false);
        await user.click(screen.getByRole("button", { name: "create here" }));
        expect(await screen.findByLabelText(field)).toHaveValue("");
        expect(saveRequests()).toHaveLength(1);
      },
    );
  });
});

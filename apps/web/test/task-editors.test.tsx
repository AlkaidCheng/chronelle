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
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { TaskForm } from "../features/events/task-form";
import { TaskInspector } from "../features/events/task-inspector";
import { queryKeys } from "../lib/queries";

const eventId = "019d6e7d-0000-7000-8000-000000000010";
const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const task = {
  id: "019d6e7d-0000-7000-8000-000000000011",
  workspaceId,
  permissionScopeId: eventId,
  objectType: "task" as const,
  displayName: "Confirm guests",
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  status: "todo" as const,
  dueAt: "2030-07-03T18:30:45.678Z",
  completedAt: null,
};
const access = { resourceId: task.id, actions: ["view", "edit"] };
const failure = (status: number) =>
  Response.json(
    {
      error: {
        code: "unavailable",
        message: "Unavailable",
        requestId: "test-request",
      },
    },
    { status },
  );

function Harness({ create = false }: { create?: boolean }) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queries = useQueryClient();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          queries.setQueryData(queryKeys.objectResource(task.id), task);
          queries.setQueryData(queryKeys.access(task.id), access);
          setOpen(true);
        }}
      >
        Open task
      </button>
      <button
        type="button"
        disabled={refreshing}
        onClick={async () => {
          setRefreshing(true);
          try {
            await queries.invalidateQueries();
          } finally {
            setRefreshing(false);
          }
        }}
      >
        Refresh queries
      </button>
      {open &&
        (create ? (
          <TaskForm eventId={eventId} onCancel={() => setOpen(false)} />
        ) : (
          <TaskInspector
            eventId={eventId}
            taskId={task.id}
            onClose={() => setOpen(false)}
          />
        ))}
    </>
  );
}

describe("focused Task editors", () => {
  beforeEach(() => {
    for (const method of ["showModal", "close"] as const)
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.toggleAttribute("open", method === "showModal");
        },
      });
    sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("checks fresh canonical data and access before exposing cached fields", async () => {
    const deferred = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith("/access")
          ? deferred.promise
          : Response.json(task),
      ),
    );
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open task" }));
    expect(screen.queryByLabelText("Task")).toBeNull();
    await act(async () => deferred.resolve(Response.json(access)));
    expect(await screen.findByLabelText("Task")).toHaveValue(task.displayName);
    expect(screen.getByLabelText("Task")).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveClass("event-inspector");
  });

  it.each([401, 403, 404, "viewer"] as const)(
    "hides cached fields after fresh %s access denial",
    async (denial) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input) =>
          String(input).endsWith("/access")
            ? denial === "viewer"
              ? Response.json({ ...access, actions: ["view"] })
              : failure(denial)
            : Response.json(task),
        ),
      );
      const user = userEvent.setup();
      render(<Harness />, { wrapper: Providers });
      await user.click(screen.getByRole("button", { name: "Open task" }));
      await waitFor(
        () =>
          expect(screen.getByRole("alert")).toHaveTextContent(
            "no longer available",
          ),
        { timeout: 3000 },
      );
      expect(screen.queryByLabelText("Task")).toBeNull();
    },
  );

  it("preserves mounted input on temporary refetch failures and clears it on revocation", async () => {
    let status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) =>
        status === 200
          ? Response.json(String(input).endsWith("/access") ? access : task)
          : failure(status),
      ),
    );
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open task" }));
    const input = await screen.findByLabelText("Task");
    await user.clear(input);
    await user.type(input, "Private draft");
    status = 503;
    await user.click(screen.getByRole("button", { name: "Refresh queries" }));
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Refresh queries" }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );
    await waitFor(() => expect(screen.getByLabelText("Task")).toBe(input));
    expect(input).toHaveValue("Private draft");
    status = 403;
    await user.click(screen.getByRole("button", { name: "Refresh queries" }));
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Refresh queries" }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );
    expect(screen.queryByLabelText("Task")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });

  it("confirms dirty dismissal, restores focus and discards without a write", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<Harness create />, { wrapper: Providers });
    const trigger = screen.getByRole("button", { name: "Open task" });
    await user.click(trigger);
    const input = screen.getByLabelText("Task");
    expect(input).toHaveFocus();
    await user.type(input, "Pack bags");
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Pack bags");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains failed creation fields and retry identity while locking a pending save", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("Lost response"))
      .mockImplementationOnce(() => pending.promise);
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<Harness create />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open task" }));
    const input = screen.getByLabelText("Task");
    await user.type(input, "Pack bags");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("Pack bags");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    const commands = fetch.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(commands[0].commandId).toBe(commands[1].commandId);
    await act(async () =>
      pending.resolve(
        Response.json({
          resource: { ...task, displayName: "Pack bags", dueAt: null },
          relationId: eventId,
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "restores lost save focus without stealing another control's focus (moved: %s)",
    async (moved) => {
      const pending = Promise.withResolvers<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(() => pending.promise),
      );
      const user = userEvent.setup();
      render(<Harness create />, { wrapper: Providers });
      await user.click(screen.getByRole("button", { name: "Open task" }));
      const input = screen.getByLabelText("Task");
      await user.type(input, "Pack bags");
      const form = input.closest("form");
      if (!form) throw new Error("Task form is missing.");
      fireEvent.submit(form);
      await waitFor(() => expect(input).toBeDisabled());
      input.blur();
      const other = screen.getByRole("button", { name: "Refresh queries" });
      if (moved) other.focus();
      await act(async () => pending.resolve(failure(503)));
      await screen.findByRole("alert");
      expect(moved ? other : input).toHaveFocus();
    },
  );

  it("preserves exact due seconds in a name-only versioned update", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (init?.method === "PATCH")
        return Response.json({
          ...task,
          displayName: "Confirm headcount",
          version: 2,
        });
      return Response.json(String(input).endsWith("/access") ? access : task);
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<Harness />, { wrapper: Providers });
    await user.click(screen.getByRole("button", { name: "Open task" }));
    const input = await screen.findByLabelText("Task");
    await user.clear(input);
    await user.type(input, "Confirm headcount");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      displayName: "Confirm headcount",
      dueAt: task.dueAt,
      expectedVersion: 1,
    });
  });
});

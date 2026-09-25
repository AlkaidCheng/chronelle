// @vitest-environment jsdom

import { ApiClientError } from "@livtales/api-client";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { usePageCommandHistory } from "../lib/command-history";
import { commandHistoryKey } from "../lib/commands";
import { useKeepEditorDraft } from "../lib/editor-draft-context";
import {
  useCommandState,
  useCommandTransition,
  useUpdateTask,
} from "../lib/queries";
import { readTaskFields } from "../lib/task-fields";

// Kai's session is in his own workspace; the Event and its Task live in
// Mei's, shared with him. Their commands are kept where they live.
const kaiWorkspace = "019d6e7d-0000-7000-8000-000000000001";
const meiWorkspace = "019d6e7d-0000-7000-8000-000000000002";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const taskId = "019d6e7d-0000-7000-8000-000000000012";
const commandId = "019d6e7d-0000-7000-8000-000000000020";

const task = {
  id: taskId,
  workspaceId: meiWorkspace,
  objectType: "task",
  displayName: "Call the florist today",
  permissionScopeId: eventId,
  createdBy: meiWorkspace,
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:01:00.000Z",
  version: 2,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  status: "todo",
  dueAt: null,
  completedAt: null,
};

function receipt(direction: string, stackVersion: number) {
  return {
    operationId: crypto.randomUUID(),
    commandId,
    direction,
    stackVersion,
    objects: [{ id: taskId, version: 2 }],
  };
}

/** Answers the command routes and records each request as method and URL. */
function stubCommands(state: object) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.startsWith("/api/commands/undo"))
      return Response.json(receipt("undo", 5));
    if (url.startsWith("/api/commands") && method === "GET")
      return Response.json(state);
    if (url.startsWith("/api/commands"))
      return Response.json(receipt("execute", 4));
    if (url === `/api/tasks/${taskId}`) return Response.json(task);
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

describe("commands on a shared record", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({
        accessToken: "test-session",
        workspaceId: kaiWorkspace,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("saves an edit on the stack in the workspace the record lives in", async () => {
    const calls = stubCommands({ version: 3, undo: null, redo: null });
    const { result } = renderHook(
      () => ({ client: useQueryClient(), update: useUpdateTask() }),
      { wrapper: Providers },
    );
    await act(() =>
      result.current.update.mutateAsync({
        id: taskId,
        workspaceId: meiWorkspace,
        input: { expectedVersion: 1, displayName: "Call the florist today" },
      }),
    );
    expect(
      calls.slice(0, 2).map(({ method, url }) => `${method} ${url}`),
    ).toEqual([`GET /api/commands?objectId=${taskId}`, "POST /api/commands"]);
    expect(calls[1]?.body).toMatchObject({ expectedStackVersion: 3 });
    const cache = result.current.client;
    expect(
      cache.getQueryData(commandHistoryKey({ workspaceId: meiWorkspace })),
    ).toMatchObject({ version: 4, undo: { commandId, available: true } });
    expect(
      cache.getQueryData(commandHistoryKey({ workspaceId: kaiWorkspace })),
    ).toBeUndefined();
  });

  it("undoes on the stack of the shared record a page shows", async () => {
    const calls = stubCommands({
      version: 4,
      undo: { commandId, available: true },
      redo: null,
    });
    const { result } = renderHook(
      () => {
        usePageCommandHistory({ id: eventId, workspaceId: meiWorkspace });
        return {
          state: useCommandState(),
          undo: useCommandTransition("undo"),
        };
      },
      { wrapper: Providers },
    );
    await waitFor(() =>
      expect(result.current.state.data?.undo?.commandId).toBe(commandId),
    );
    await act(() => result.current.undo.mutateAsync());
    const undo = calls.find(({ url }) => url.startsWith("/api/commands/undo"));
    expect(undo?.url).toBe(`/api/commands/undo?objectId=${eventId}`);
    expect(undo?.body).toMatchObject({ commandId, expectedStackVersion: 4 });
    expect(calls).toContainEqual({
      method: "GET",
      url: `/api/commands?objectId=${eventId}`,
      body: undefined,
    });
  });

  it("says a refused save aloud when the editor closes", async () => {
    stubCommands({ version: 0, undo: null, redo: null });
    const baseline = readTaskFields();
    const snapshot = {
      kind: "task" as const,
      source: undefined,
      baseline,
      fields: { ...baseline, displayName: "Call the florist" },
    };
    const onAccessLost = vi.fn();
    function Editor() {
      const recovery = useKeepEditorDraft(
        `task:${taskId}`,
        snapshot,
        true,
        onAccessLost,
      );
      return (
        <button
          type="button"
          onClick={() =>
            void recovery.save(
              () =>
                Promise.reject(
                  new ApiClientError(
                    404,
                    "resource_unavailable",
                    "The requested resource is unavailable.",
                  ),
                ),
              () => undefined,
            )
          }
        >
          Save
        </button>
      );
    }
    render(<Editor />, { wrapper: Providers });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your changes were not saved: this item is no longer available to you.",
    );
    expect(onAccessLost).toHaveBeenCalledOnce();
  });
});

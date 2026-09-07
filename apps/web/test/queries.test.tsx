// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { queryKeys, useCreateTask, useUpdateTask } from "../lib/queries";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000010";
const otherEventId = "019d6e7d-0000-7000-8000-000000000011";
const taskId = "019d6e7d-0000-7000-8000-000000000012";

describe("canonical cache invalidation", () => {
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

  it("retries an uncertain create with the same command and starts a fresh command after success", async () => {
    const response = {
      relationId: otherEventId,
      resource: {
        id: taskId,
        workspaceId,
        objectType: "task",
        displayName: "Task",
        permissionScopeId: eventId,
        createdBy: workspaceId,
        createdAt: "2026-09-02T20:00:00.000Z",
        updatedAt: "2026-09-02T20:00:00.000Z",
        version: 1,
        archivedAt: null,
        deletedAt: null,
        customProperties: {},
        metadata: {},
        status: "todo",
        dueAt: null,
        completedAt: null,
      },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("Connection interrupted"))
      .mockImplementation(async () => Response.json(response));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useCreateTask(eventId), {
      wrapper: Providers,
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ displayName: "Task" }),
      ).rejects.toThrow("The Chronelle API could not be reached.");
    });
    await act(() => result.current.mutateAsync({ displayName: "Task" }));
    await act(() => result.current.mutateAsync({ displayName: "Task" }));
    const bodies = fetch.mock.calls.map(([, options]) =>
      JSON.parse(String(options?.body)),
    );
    expect(bodies[0].commandId).toBe(bodies[1].commandId);
    expect(bodies[2].commandId).not.toBe(bodies[1].commandId);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      Array(3).fill(`/api/events/${eventId}/resources`),
    );
    expect(bodies[0].resource).toEqual({
      objectType: "task",
      displayName: "Task",
    });
  });

  it("marks every cached context, search, and attachment list stale without eagerly refetching inactive queries", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        id: taskId,
        workspaceId,
        objectType: "task",
        displayName: "Updated task",
        permissionScopeId: eventId,
        createdBy: workspaceId,
        createdAt: "2026-09-02T20:00:00.000Z",
        updatedAt: "2026-09-02T20:01:00.000Z",
        version: 2,
        archivedAt: null,
        deletedAt: null,
        customProperties: {},
        metadata: {},
        status: "done",
        dueAt: null,
        completedAt: "2026-09-02T20:01:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(
      () => ({ client: useQueryClient(), mutation: useUpdateTask() }),
      { wrapper: Providers },
    );
    const keys = [
      queryKeys.events,
      queryKeys.eventResource(eventId),
      queryKeys.detail(eventId),
      queryKeys.todos(eventId),
      queryKeys.detail(otherEventId),
      queryKeys.timeline(otherEventId),
      queryKeys.search({ query: "task" }),
      queryKeys.attachments(taskId),
    ];
    for (const key of [...keys, queryKeys.session])
      result.current.client.setQueryData(key, {});

    await act(() =>
      result.current.mutation.mutateAsync({
        id: taskId,
        input: { expectedVersion: 1, status: "done" },
      }),
    );
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    for (const key of keys)
      expect(result.current.client.getQueryState(key)?.isInvalidated).toBe(
        true,
      );
    expect(
      result.current.client.getQueryState(queryKeys.session)?.isInvalidated,
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { queryKeys, useUpdateTask } from "../lib/queries";

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

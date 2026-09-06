// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { useAuthSession } from "../lib/auth-session";
import { useApiClient } from "../lib/api-context";
import {
  useCreateEvent,
  useEventsQuery,
  useObjectSearch,
} from "../lib/queries";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const sharedWorkspaceId = "019d6e7d-0000-7000-8000-000000000002";
const credential = { accessToken: "test-session", workspaceId };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("client session isolation", () => {
  it("resets drafts and ignores transitions from an abandoned session", () => {
    const { result } = renderHook(
      () => ({ auth: useAuthSession(), draft: useState("") }),
      { wrapper: Providers },
    );
    act(() => result.current.auth.startSession(credential));
    const previous = result.current.auth;
    act(() => result.current.draft[1]("Private draft"));
    act(() => result.current.auth.switchWorkspace(sharedWorkspaceId));
    expect(previous.signal.aborted).toBe(true);
    expect(result.current.draft[0]).toBe("");
    act(() => previous.signOut());
    act(() =>
      previous.startSession({ ...credential, accessToken: "stale-session" }),
    );
    expect(result.current.auth.credential?.workspaceId).toBe(sharedWorkspaceId);
    expect(result.current.auth.credential?.accessToken).toBe(
      credential.accessToken,
    );
    const shared = result.current.auth;
    act(() => result.current.auth.switchWorkspace(sharedWorkspaceId));
    expect(result.current.auth).toBe(shared);
  });

  it("keeps a live session through strict effect replay and aborts it on unmount", async () => {
    window.sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify(credential),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [] })),
    );
    const { result, unmount } = renderHook(
      () => ({ auth: useAuthSession(), events: useEventsQuery() }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <StrictMode>
            <Providers>{children}</Providers>
          </StrictMode>
        ),
      },
    );
    await waitFor(() => expect(result.current.events.isSuccess).toBe(true));
    const signal = result.current.auth.signal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("discards late reads across a workspace round trip without reusing the old cache", async () => {
    window.sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify(credential),
    );
    const pending = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async () => Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(
      () => ({
        auth: useAuthSession(),
        cache: useQueryClient(),
        events: useEventsQuery(),
      }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const original = result.current.cache;
    const originalSignal = fetch.mock.calls[0]?.[1]?.signal;
    act(() => result.current.auth.switchWorkspace(sharedWorkspaceId));
    await waitFor(() => expect(result.current.events.isSuccess).toBe(true));
    act(() => result.current.auth.switchWorkspace(workspaceId));
    await waitFor(() => expect(result.current.events.isSuccess).toBe(true));
    expect(result.current.cache).not.toBe(original);
    expect(originalSignal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve(
        Response.json({
          items: [
            {
              id: "019d6e7d-0000-7000-8000-000000000003",
              workspaceId,
              objectType: "event",
              displayName: "Private event",
              createdBy: workspaceId,
              permissionScopeId: "019d6e7d-0000-7000-8000-000000000003",
              createdAt: "2026-09-02T20:00:00.000Z",
              updatedAt: "2026-09-02T20:00:00.000Z",
              version: 1,
              archivedAt: null,
              deletedAt: null,
              customProperties: {},
              metadata: {},
              startsAt: null,
              endsAt: null,
              timezone: "UTC",
              isAllDay: false,
            },
          ],
        }),
      ),
    );
    expect(result.current.events.data).toEqual({ items: [] });
    expect(original.getQueryCache().getAll()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      JSON.stringify(
        result.current.cache
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey),
      ),
    ).not.toContain(credential.accessToken);
  });

  it("cancels an abandoned search without ending the session", async () => {
    window.sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify(credential),
    );
    const pending = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async () => Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(
      ({ query }) => ({
        auth: useAuthSession(),
        search: useObjectSearch({ query }),
      }),
      {
        initialProps: { query: "first" },
        wrapper: Providers,
      },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ query: "second" });
    await waitFor(() => expect(result.current.search.isSuccess).toBe(true));
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(result.current.auth.signal.aborted).toBe(false);
    await act(async () => pending.resolve(Response.json({ items: [] })));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a late mutation and its retained client after sign-out and sign-in", async () => {
    window.sessionStorage.setItem(
      "chronelle.development-session",
      JSON.stringify(credential),
    );
    const pending = Promise.withResolvers<Response>();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(
      () => ({
        auth: useAuthSession(),
        api: useApiClient(),
        create: useCreateEvent(),
      }),
      { wrapper: Providers },
    );
    const original = result.current.api;
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.create.mutateAsync({
        displayName: "Event",
        startsAt: "2026-10-15T16:00:00.000Z",
        timezone: "UTC",
      });
    });
    const rejected = expect(mutation).rejects.toMatchObject({
      name: "AbortError",
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => result.current.auth.signOut());
    act(() => result.current.auth.startSession(credential));
    await act(async () => {
      pending.resolve(Response.json({}));
      await rejected;
    });
    expect(result.current.create.isIdle).toBe(true);
    await expect(original.listEvents()).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["getItem", "setItem", "removeItem"] as const)(
    "allows session transitions when storage %s throws",
    (method) => {
      window.sessionStorage.setItem(
        "chronelle.development-session",
        JSON.stringify(credential),
      );
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("Storage denied", "SecurityError");
      });
      const { result } = renderHook(useAuthSession, { wrapper: Providers });
      expect(result.current.isHydrated).toBe(true);
      act(() => result.current.startSession(credential));
      act(() => result.current.switchWorkspace(sharedWorkspaceId));
      expect(result.current.credential?.workspaceId).toBe(sharedWorkspaceId);
      act(() => result.current.signOut());
      expect(result.current.credential).toBeNull();
    },
  );

  it("rejects malformed stored credentials even when removal fails", () => {
    window.sessionStorage.setItem("chronelle.development-session", "{");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Storage denied");
    });
    const { result } = renderHook(useAuthSession, { wrapper: Providers });
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.credential).toBeNull();
  });

  it("replaces the cache on workspace changes and sign-out", () => {
    const { result } = renderHook(
      () => ({
        auth: useAuthSession(),
        cache: useQueryClient(),
      }),
      { wrapper: Providers },
    );
    act(() => result.current.auth.startSession(credential));
    const previous = result.current.cache;
    previous.setQueryData(["events"], { private: true });
    act(() => result.current.auth.switchWorkspace(sharedWorkspaceId));
    expect(result.current.cache).not.toBe(previous);
    expect(result.current.cache.getQueryData(["events"])).toBeUndefined();
    expect(previous.getQueryCache().getAll()).toHaveLength(0);
    const shared = result.current.cache;
    act(() => result.current.auth.signOut());
    expect(result.current.cache).not.toBe(shared);
    expect(result.current.auth.credential).toBeNull();
  });

  it("supports an in-memory session when browser storage is denied", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    const { result } = renderHook(useAuthSession, { wrapper: Providers });
    expect(result.current.isHydrated).toBe(true);
    act(() => result.current.startSession(credential));
    expect(result.current.credential?.workspaceId).toBe(workspaceId);
    act(() => result.current.switchWorkspace(sharedWorkspaceId));
    expect(result.current.credential?.workspaceId).toBe(sharedWorkspaceId);
    expect(result.current.credential?.homeWorkspaceId).toBe(workspaceId);
    act(() => result.current.signOut());
    expect(result.current.credential).toBeNull();
  });
});

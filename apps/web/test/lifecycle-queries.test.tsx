// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { useAuthSession } from "../lib/auth-session";
import {
  useLifecycleActions,
  type LifecycleTarget,
} from "../lib/recovery-queries";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000002";
const taskId = "019d6e7d-0000-7000-8000-000000000003";
const secondId = "019d6e7d-0000-7000-8000-000000000004";
const relationId = "019d6e7d-0000-7000-8000-000000000005";
const target: LifecycleTarget = {
  id: taskId,
  eventId,
  displayName: "Old task",
  version: 1,
};
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
let removed = false;

beforeEach(() => {
  removed = false;
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({
      accessToken: "test-session",
      workspaceId,
    }),
  );
  fetch = vi.fn<typeof globalThis.fetch>(async (input, options) => {
    const url = new URL(String(input), "http://example.test");
    if (options?.method === "DELETE") {
      removed = true;
      return Response.json({
        id: relationId,
        version: 4,
        deletedAt: "2026-09-02T20:00:00.000Z",
      });
    }
    if (url.pathname.endsWith("/access"))
      return Response.json({
        resourceId: url.pathname.split("/").at(-2),
        actions: ["view", "edit", "delete"],
      });
    const matches =
      url.searchParams.get("otherObjectId") === taskId && !removed;
    return Response.json({
      items: matches
        ? [
            {
              id: relationId,
              version: 3,
              workspaceId,
              sourceObjectId: eventId,
              targetObjectId: taskId,
              relationType: "includes",
              metadata: {},
              createdBy: workspaceId,
              createdAt: "2026-09-02T20:00:00.000Z",
              deletedAt: null,
            },
          ]
        : [],
      nextCursor: null,
    });
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

it("looks up the exact inclusion and invalidates it after versioned removal", async () => {
  const { result } = renderHook(() => useLifecycleActions(target), {
    wrapper: Providers,
  });
  await waitFor(() =>
    expect(result.current.inclusion).toMatchObject({
      id: relationId,
      version: 3,
    }),
  );
  const request = fetch.mock.calls.find(([url]) =>
    String(url).includes("/relations?"),
  );
  expect(String(request?.[0])).toBe(
    `/api/objects/${eventId}/relations?direction=outgoing&relationType=includes&otherObjectId=${taskId}&limit=1`,
  );
  await act(() =>
    result.current.remove.mutateAsync({ id: relationId, version: 3 }),
  );
  await waitFor(() => expect(result.current.inclusion).toBeUndefined());
  expect(
    fetch.mock.calls.some(
      ([url, options]) =>
        String(url) === `/api/relations/${relationId}?expectedVersion=3` &&
        options?.method === "DELETE",
    ),
  ).toBe(true);
});

it("does not reuse another target's inclusion from the same Event cache", async () => {
  const { result, rerender } = renderHook(
    (input: LifecycleTarget) => useLifecycleActions(input),
    {
      wrapper: Providers,
      initialProps: target,
    },
  );
  await waitFor(() => expect(result.current.inclusion?.id).toBe(relationId));
  rerender({ ...target, id: secondId });
  expect(result.current.inclusion).toBeUndefined();
  await waitFor(() => expect(result.current.relations.isSuccess).toBe(true));
  expect(result.current.inclusion).toBeUndefined();
  expect(
    fetch.mock.calls.some(([url]) =>
      String(url).includes(`otherObjectId=${secondId}`),
    ),
  ).toBe(true);
});

it("cancels an abandoned exact lookup without ending the session", async () => {
  const respond = fetch.getMockImplementation();
  if (!respond) throw new Error("The response fixture is required.");
  const pending = Promise.withResolvers<void>();
  fetch.mockImplementation(async (...args) => {
    const response = await respond(...args);
    if (String(args[0]).includes(`otherObjectId=${taskId}`))
      await pending.promise;
    return response;
  });
  const { result, rerender } = renderHook(
    (input: LifecycleTarget) => ({
      auth: useAuthSession(),
      lifecycle: useLifecycleActions(input),
    }),
    { wrapper: Providers, initialProps: target },
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).includes(`otherObjectId=${taskId}`),
      ),
    ).toBe(true),
  );
  const request = fetch.mock.calls.find(([url]) =>
    String(url).includes(`otherObjectId=${taskId}`),
  );
  rerender({ ...target, id: secondId });
  await waitFor(() =>
    expect(result.current.lifecycle.relations.isSuccess).toBe(true),
  );
  expect(request?.[1]?.signal?.aborted).toBe(true);
  expect(result.current.auth.signal.aborted).toBe(false);
  await act(async () => pending.resolve());
  expect(result.current.lifecycle.inclusion).toBeUndefined();
  expect(result.current.lifecycle.relations.data).toEqual({
    items: [],
    nextCursor: null,
  });
});

it.each([
  { id: taskId, displayName: "Standalone task", version: 1 },
  { ...target, relation: { id: relationId, version: 3 } },
])("skips unnecessary inclusion queries for %j", async (input) => {
  const { result } = renderHook(() => useLifecycleActions(input), {
    wrapper: Providers,
  });
  await waitFor(() => expect(result.current.objectAccess.isSuccess).toBe(true));
  expect(
    fetch.mock.calls.some(([url]) => String(url).includes("/relations")),
  ).toBe(false);
  expect(result.current.inclusion).toEqual(
    "relation" in input ? input.relation : undefined,
  );
});

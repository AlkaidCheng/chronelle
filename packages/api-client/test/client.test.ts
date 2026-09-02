import { describe, expect, it, vi } from "vitest";

import { ChronelleApiClient } from "../src/index.js";

const event = {
  id: "019d6e7d-0000-7000-8000-000000000001",
  workspaceId: "019d6e7d-0000-7000-8000-000000000002",
  objectType: "event",
  displayName: "Launch night",
  createdBy: "019d6e7d-0000-7000-8000-000000000003",
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000001",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  startsAt: "2026-10-15T16:00:00.000Z",
  endsAt: null,
  timezone: "America/Los_Angeles",
  isAllDay: false,
} as const;

describe("ChronelleApiClient", () => {
  it("adds the active identity and workspace to protected requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [event] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new ChronelleApiClient({
      baseUrl: "http://api.example.test/",
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });

    await expect(client.listEvents()).resolves.toEqual({ items: [event] });
    const [url, request] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("http://api.example.test/api/events");
    expect(headers.get("authorization")).toBe("Bearer opaque-session");
    expect(headers.get("x-workspace-id")).toBe(event.workspaceId);
  });

  it("returns typed conflict details for optimistic concurrency failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "version_conflict",
            message: "The object changed before this update.",
          },
        }),
        { headers: { "content-type": "application/json" }, status: 409 },
      ),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });

    await expect(
      client.updateEvent(event.id, {
        displayName: "Stale edit",
        expectedVersion: 1,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "version_conflict", status: 409 }),
    );
  });

  it("rejects protected calls before reaching the network without a session", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new ChronelleApiClient({ fetch });

    await expect(client.listEvents()).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes unreadable upstream responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("Service unavailable", { status: 502 }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });

    await expect(client.listEvents()).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
  });
});

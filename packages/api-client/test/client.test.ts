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

const documentId = "019d6e7d-0000-7000-8000-000000000010";
const uploadAuthorizationId = "019d6e7d-0000-7000-8000-000000000011";
const relationId = "019d6e7d-0000-7000-8000-000000000012";

const documentAttachment = {
  relationId,
  relationVersion: 1,
  document: {
    id: documentId,
    workspaceId: event.workspaceId,
    objectType: "document",
    displayName: "brief.txt",
    createdBy: event.createdBy,
    permissionScopeId: event.id,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
    originalFilename: "brief.txt",
    mimeType: "text/plain",
    sizeBytes: "5",
    checksumSha256:
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    storageProvider: "local-filesystem",
    encryptionMode: "filesystem-permissions",
  },
} as const;

describe("ChronelleApiClient", () => {
  it("sends versioned deletion and recovery requests without duplicating object data", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ id: event.id, version: 2, deletedAt: event.updatedAt }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: relationId,
          version: 4,
          deletedAt: event.updatedAt,
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...event, version: 3 }))
      .mockResolvedValueOnce(Response.json({ items: [], nextBeforeId: null }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    await client.deleteObject(event.id, 1);
    await client.deleteRelation(relationId, 3);
    await client.recoverObject(event.id, { expectedVersion: 2 });
    await client.listTrash({
      objectType: "event",
      limit: 1,
      beforeId: event.id,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/objects/${event.id}?expectedVersion=1`,
      `/api/relations/${relationId}?expectedVersion=3`,
      `/api/objects/${event.id}/recover`,
      `/api/trash?objectType=event&limit=1&beforeId=${event.id}`,
    ]);
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      expectedVersion: 2,
    });
  });
  it("encodes comparison versions and sends only the restore precondition", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          objectId: event.id,
          fromVersion: 1,
          toVersion: 2,
          changes: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          objectId: event.id,
          sourceRevisionId: documentId,
          sourceVersion: 1,
          currentVersion: 2,
          canRestore: true,
          changes: [],
          preservedFields: [],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...event, version: 3 }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    await client.compareObjectRevisions(event.id, {
      fromVersion: 1,
      toVersion: 2,
    });
    await client.previewObjectRestoration(event.id, 1);
    expect(
      (await client.restoreObjectRevision(event.id, 1, { expectedVersion: 2 }))
        .version,
    ).toBe(3);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/objects/${event.id}/revisions/compare?fromVersion=1&toVersion=2`,
      `/api/objects/${event.id}/revisions/1/restore-preview`,
      `/api/objects/${event.id}/revisions/1/restore`,
    ]);
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: '{"expectedVersion":2}',
    });
  });
  it("preserves a supplied create command ID and validates the committed result", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({ resource: event, relationId }),
      );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    const input = {
      commandId: uploadAuthorizationId,
      resource: {
        objectType: "event" as const,
        displayName: event.displayName,
      },
    };
    await expect(client.createEventResource(event.id, input)).resolves.toEqual({
      resource: event,
      relationId,
    });
    await client.createEventResource(event.id, input);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      Array(2).fill(`/api/events/${event.id}/resources`),
    );
    for (const [, request] of fetch.mock.calls)
      expect(JSON.parse(String(request?.body))).toEqual(input);
  });

  it("encodes bounded history pages and rejects malformed snapshots", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [], nextBeforeVersion: null }),
      )
      .mockResolvedValueOnce(Response.json({ snapshot: { id: event.id } }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    await expect(
      client.listObjectRevisions(event.id, { limit: 5, beforeVersion: 9 }),
    ).resolves.toEqual({ items: [], nextBeforeVersion: null });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/objects/${event.id}/revisions?limit=5&beforeVersion=9`,
    );
    await expect(client.getObjectRevision(event.id, 1)).rejects.toThrow();
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `/api/objects/${event.id}/revisions/1`,
    );
  });
  it("encodes typed object search filters", async () => {
    const searchResult = {
      id: event.id,
      displayName: event.displayName,
      objectType: event.objectType,
      permissionScopeId: event.permissionScopeId,
      updatedAt: event.updatedAt,
      version: event.version,
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [searchResult] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });

    await expect(
      client.searchObjects({ limit: 10, objectType: "event", query: "launch" }),
    ).resolves.toEqual({ items: [searchResult] });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/search?query=launch&limit=10&objectType=event",
    );
  });

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

  it("uploads bytes through an opaque transfer without forwarding the session", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: uploadAuthorizationId,
            upload: {
              expiresAt: "2026-09-02T20:05:00.000Z",
              headers: { "content-type": "application/octet-stream" },
              method: "PUT",
              url: "/api/document-transfers/upload/opaque-upload-token",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(documentAttachment), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      );
    const client = new ChronelleApiClient({
      baseUrl: "https://chronelle.example",
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });
    const bytes = new TextEncoder().encode("hello");

    await expect(
      client.attachDocument(event.id, {
        arrayBuffer: async () => bytes.buffer,
        name: "brief.txt",
        size: bytes.byteLength,
        type: "text/plain",
      }),
    ).resolves.toEqual(documentAttachment);

    const [authorizationUrl, authorizationRequest] = fetch.mock.calls[0] ?? [];
    expect(authorizationUrl).toBe(
      "https://chronelle.example/api/documents/upload-url",
    );
    expect(JSON.parse(String(authorizationRequest?.body))).toMatchObject({
      checksumSha256: documentAttachment.document.checksumSha256,
      originalFilename: "brief.txt",
      parentObjectId: event.id,
      sizeBytes: 5,
    });

    const [uploadUrl, uploadRequest] = fetch.mock.calls[1] ?? [];
    const uploadHeaders = new Headers(uploadRequest?.headers);
    expect(uploadUrl).toBe(
      "https://chronelle.example/api/document-transfers/upload/opaque-upload-token",
    );
    expect(uploadRequest?.method).toBe("PUT");
    expect(uploadRequest?.body).toEqual(bytes.buffer);
    expect(uploadHeaders.get("authorization")).toBeNull();
    expect(uploadHeaders.get("x-workspace-id")).toBeNull();

    const [finalizationUrl, finalizationRequest] = fetch.mock.calls[2] ?? [];
    expect(finalizationUrl).toBe("https://chronelle.example/api/documents");
    expect(finalizationRequest?.method).toBe("POST");
    expect(new Headers(finalizationRequest?.headers).get("authorization")).toBe(
      "Bearer opaque-session",
    );
  });

  it("downloads private bytes only after obtaining a fresh authorization", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            download: {
              expiresAt: "2026-09-02T20:05:00.000Z",
              headers: {},
              method: "GET",
              url: "/api/document-transfers/download/opaque-download-token",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("private file", {
          headers: { "content-type": "text/plain" },
          status: 200,
        }),
      );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });

    const result = await client.downloadDocument(documentId);

    await expect(result.text()).resolves.toBe("private file");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/documents/${documentId}/download-url`,
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/document-transfers/download/opaque-download-token",
    );
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization"),
    ).toBeNull();
  });
});

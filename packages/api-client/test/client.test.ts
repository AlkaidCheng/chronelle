import { describe, expect, it, vi } from "vitest";

import { type ApiCredential, ChronelleApiClient } from "../src/index.js";

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
  startsOn: null,
  endsOn: null,
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
  it("reads a canonical Reminder with workspace credentials and validates its response", async () => {
    const reminder = {
      ...event,
      objectType: "reminder",
      remindAt: event.createdAt,
      status: "dismissed",
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(reminder),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    expect(await client.getReminder(event.id)).toMatchObject({
      id: event.id,
      objectType: "reminder",
      status: "dismissed",
      remindAt: event.createdAt,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/reminders/${event.id}`);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-session");
    expect(headers.get("x-workspace-id")).toBe(event.workspaceId);
    fetch.mockResolvedValueOnce(Response.json({ ...reminder, remindAt: "invalid" }));
    await expect(client.getReminder(event.id)).rejects.toThrow();
  });
  it("reads a canonical Expense with workspace credentials and validates decimal data", async () => {
    const expense = {
      ...event,
      objectType: "expense",
      amount: "-0.0001",
      currency: "USD",
      occurredAt: event.createdAt,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(expense),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    expect(await client.getExpense(event.id)).toMatchObject({
      id: event.id,
      objectType: "expense",
      amount: "-0.0001",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/expenses/${event.id}`);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-session");
    expect(headers.get("x-workspace-id")).toBe(event.workspaceId);
    fetch.mockResolvedValueOnce(Response.json({ ...expense, amount: 0.1 }));
    await expect(client.getExpense(event.id)).rejects.toThrow();
  });
  it("reads a canonical Task with workspace credentials and validates its response", async () => {
    const task = {
      ...event,
      objectType: "task",
      status: "todo",
      dueAt: null,
      completedAt: null,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(task),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    expect(await client.getTask(event.id)).toMatchObject({
      id: event.id,
      objectType: "task",
      dueAt: null,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/tasks/${event.id}`);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-session");
    expect(headers.get("x-workspace-id")).toBe(event.workspaceId);
    fetch.mockResolvedValueOnce(Response.json({ ...task, dueAt: "invalid" }));
    await expect(client.getTask(event.id)).rejects.toThrow();
  });
  it("reads bounded layout history and restores with optimistic concurrency", async () => {
    const layout = {
      eventId: event.id,
      version: 2,
      updatedAt: event.updatedAt,
      pages: [],
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ items: [layout], nextBeforeVersion: null }),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    expect(
      await client.getEventLayoutHistory(event.id, {
        beforeVersion: 3,
        limit: 2,
      }),
    ).toEqual({ items: [layout], nextBeforeVersion: null });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/events/${event.id}/layout/history?beforeVersion=3&limit=2`,
    );
    fetch.mockResolvedValueOnce(Response.json(layout));
    expect(
      await client.restoreEventLayout(event.id, {
        expectedVersion: 1,
        targetVersion: 0,
      }),
    ).toEqual(layout);
    expect(fetch.mock.calls[1]).toEqual([
      `/api/events/${event.id}/layout/restore`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, targetVersion: 0 }),
      }),
    ]);
    fetch.mockResolvedValueOnce(
      Response.json({
        items: [{ ...layout, version: "invalid" }],
        nextBeforeVersion: null,
      }),
    );
    await expect(client.getEventLayoutHistory(event.id)).rejects.toThrow();
  });

  it("reads and validates one canonical Event with the current credential", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(event),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    expect(await client.getEvent(event.id)).toEqual(event);
    expect(fetch).toHaveBeenCalledWith(
      `/api/events/${event.id}`,
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-workspace-id"),
    ).toBe(event.workspaceId);
    fetch.mockResolvedValueOnce(
      Response.json({ ...event, version: "invalid" }),
    );
    await expect(client.getEvent(event.id)).rejects.toThrow();
  });
  it.each(["session", "query"] as const)(
    "forwards %s cancellation without converting it to a network error",
    async (source) => {
      const lifetime = new AbortController();
      const query = new AbortController();
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, request) => {
        const signal = request?.signal;
        expect(signal).toBeDefined();
        (source === "session" ? lifetime : query).abort();
        signal?.throwIfAborted();
        return Response.json({ items: [] });
      });
      const client = new ChronelleApiClient({
        fetch,
        signal: lifetime.signal,
        getCredential: () => ({
          accessToken: "test-session",
          workspaceId: event.workspaceId,
        }),
      });
      const scoped = client.withSignal(query.signal);
      await expect(scoped.listEvents()).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(scoped.listEvents()).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["read", "mutation"] as const)(
    "rejects a late %s body even when the transport ignores cancellation",
    async (operation) => {
      const lifetime = new AbortController();
      const response = Response.json(
        operation === "read" ? { items: [event] } : event,
      );
      const readBody = response.json.bind(response);
      vi.spyOn(response, "json").mockImplementation(async () => {
        lifetime.abort();
        return readBody();
      });
      const client = new ChronelleApiClient({
        signal: lifetime.signal,
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
        getCredential: () => ({
          accessToken: "test-session",
          workspaceId: event.workspaceId,
        }),
      });
      const result =
        operation === "read"
          ? client.listEvents()
          : client.updateEvent(event.id, {
              expectedVersion: 1,
              displayName: "Updated",
            });
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
    },
  );

  it("detects in-place credential changes while a response is pending", async () => {
    const credential = {
      accessToken: "test-session",
      workspaceId: event.workspaceId,
    };
    const client = new ChronelleApiClient({
      getCredential: () => credential,
      fetch: async () => {
        credential.accessToken = "replacement-session";
        return Response.json({ items: [event] });
      },
    });
    await expect(client.listEvents()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it.each(["authorization", "transfer"] as const)(
    "stops upload after a session change during %s",
    async (stage) => {
      let credential: ApiCredential = {
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      };
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementationOnce(async () => {
          if (stage === "authorization")
            credential = { ...credential, accessToken: "replacement-session" };
          return Response.json({
            id: uploadAuthorizationId,
            upload: {
              url: "https://storage.example.test/upload",
              method: "PUT",
              headers: {},
              expiresAt: "2026-09-02T20:05:00.000Z",
            },
          });
        })
        .mockImplementationOnce(async () => {
          credential = { ...credential, workspaceId: documentId };
          return new Response(null, { status: 204 });
        });
      const client = new ChronelleApiClient({
        fetch,
        getCredential: () => credential,
      });
      await expect(
        client.attachDocument(event.id, {
          name: "brief.txt",
          type: "text/plain",
          size: 0,
          arrayBuffer: async () => new ArrayBuffer(0),
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).toHaveBeenCalledTimes(stage === "authorization" ? 1 : 2);
      expect(fetch.mock.calls.some(([url]) => url === "/api/documents")).toBe(
        false,
      );
      if (stage === "transfer") {
        const headers = new Headers(fetch.mock.calls[1]?.[1]?.headers);
        expect(headers.has("authorization")).toBe(false);
        expect(headers.has("x-workspace-id")).toBe(false);
      }
    },
  );

  it("does not expose a downloaded blob after its session ends", async () => {
    const lifetime = new AbortController();
    const response = new Response("private file");
    const readBlob = response.blob.bind(response);
    vi.spyOn(response, "blob").mockImplementation(async () => {
      lifetime.abort();
      return readBlob();
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          document: documentAttachment.document,
          download: {
            url: "https://storage.example.test/download",
            method: "GET",
            headers: {},
            expiresAt: "2026-09-02T20:05:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(response);
    const client = new ChronelleApiClient({
      fetch,
      signal: lifetime.signal,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    await expect(client.downloadDocument(documentId)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch.mock.calls[1]?.[1]?.signal).toBe(lifetime.signal);
    const headers = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-workspace-id")).toBe(false);
  });

  it("rejects a late response after its workspace changes", async () => {
    let credential: ApiCredential = {
      accessToken: "test-session",
      workspaceId: event.workspaceId,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      credential = { ...credential, workspaceId: documentId };
      return Response.json({ items: [event] });
    });
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => credential,
    });
    await expect(client.listEvents()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("does not authorize an upload under a session changed while reading the file", async () => {
    let credential: ApiCredential = {
      accessToken: "test-session",
      workspaceId: event.workspaceId,
    };
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => credential,
    });
    await expect(
      client.attachDocument(event.id, {
        name: "brief.txt",
        type: "text/plain",
        size: 0,
        arrayBuffer: async () => {
          credential = { ...credential, accessToken: "replacement-session" };
          return new ArrayBuffer(0);
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests a typed workspace inventory and rejects partial responses", async () => {
    const report = {
      workspaceId: event.workspaceId,
      storageProvider: "local-filesystem",
      startedAt: event.createdAt,
      completedAt: event.createdAt,
      consistency: "observational",
      retentionPolicy: "retain-all",
      references: {
        canonical: 0,
        historicalOnly: 0,
        missingCanonical: 0,
        missingHistoricalOnly: 0,
      },
      entries: {
        canonical: 0,
        historicalOnly: 0,
        pendingUpload: 0,
        expiredUpload: 0,
        unreferenced: 0,
        unsupported: 0,
      },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(report))
      .mockResolvedValueOnce(Response.json({ entries: report.entries }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    await expect(client.getStorageInventory()).resolves.toEqual(report);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/workspace/storage-inventory");
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-workspace-id")).toBe(event.workspaceId);
    expect(headers.get("authorization")).toBe("Bearer test-session");
    await expect(client.getStorageInventory()).rejects.toThrow();
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid reported file size %s before reading",
    async (size) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const read = vi.fn().mockResolvedValue(new ArrayBuffer(0));
      const client = new ChronelleApiClient({ fetch });
      await expect(
        client.attachDocument(event.id, {
          name: "file.bin",
          type: "application/octet-stream",
          size,
          arrayBuffer: read,
        }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
      expect(read).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects a file whose bytes do not match its reported size before authorization", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new ChronelleApiClient({ fetch });
    await expect(
      client.attachDocument(event.id, {
        name: "file.bin",
        type: "application/octet-stream",
        size: 1,
        arrayBuffer: async () => new ArrayBuffer(2),
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects oversized files before reading, hashing, or requesting a transfer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const read = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    const client = new ChronelleApiClient({ fetch });
    await expect(
      client.attachDocument(event.id, {
        name: "large.bin",
        type: "application/octet-stream",
        size: 25 * 1024 * 1024 + 1,
        arrayBuffer: read,
      }),
    ).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves command IDs and stack preconditions across typed execute, undo, and redo requests", async () => {
    const commandId = documentId;
    const receipt = {
      operationId: commandId,
      commandId,
      direction: "execute",
      stackVersion: 1,
      objects: [{ id: event.id, version: 2 }],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ version: 0, undo: null, redo: null }),
      )
      .mockResolvedValueOnce(Response.json(receipt))
      .mockResolvedValueOnce(Response.json({ ...receipt, direction: "undo" }))
      .mockResolvedValueOnce(Response.json({ ...receipt, direction: "redo" }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    expect(await client.getCommandState()).toEqual({
      version: 0,
      undo: null,
      redo: null,
    });
    const command = {
      operationId: commandId,
      expectedStackVersion: 0,
      edits: [
        {
          objectType: "event" as const,
          objectId: event.id,
          patch: { expectedVersion: 1, displayName: "Updated" },
        },
      ],
    };
    expect(await client.executeCommand(command)).toEqual(receipt);
    const undo = {
      operationId: relationId,
      commandId,
      expectedStackVersion: 1,
    };
    const redo = {
      ...undo,
      operationId: uploadAuthorizationId,
      expectedStackVersion: 2,
    };
    await client.undoCommand(undo);
    await client.redoCommand(redo);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/commands",
      "/api/commands",
      "/api/commands/undo",
      "/api/commands/redo",
    ]);
    for (const [index, input] of [
      [1, command],
      [2, undo],
      [3, redo],
    ] as const) {
      expect(JSON.parse(String(fetch.mock.calls[index]?.[1]?.body))).toEqual(
        input,
      );
      const sentHeaders = new Headers(fetch.mock.calls[index]?.[1]?.headers);
      expect(sentHeaders.get("x-workspace-id")).toBe(event.workspaceId);
    }
  });
  it("forwards removed-link filters, cursors and cancellation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ items: [], nextCursor: "next_page" }));
    const controller = new AbortController();
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "test-session",
        workspaceId: event.workspaceId,
      }),
    });
    const page = await client
      .withSignal(controller.signal)
      .listRemovedRelations(event.id, {
        limit: 2,
        relationType: "includes",
        cursor: "current_page",
      });
    expect(page.nextCursor).toBe("next_page");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/objects/${event.id}/removed-relations?limit=2&relationType=includes&cursor=current_page`,
    );
    controller.abort();
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
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
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
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
      cursor: "trash_page",
      scopeId: event.id,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/objects/${event.id}?expectedVersion=1`,
      `/api/relations/${relationId}?expectedVersion=3`,
      `/api/objects/${event.id}/recover`,
      `/api/trash?objectType=event&limit=1&cursor=trash_page&scopeId=${event.id}`,
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
      new Response(
        JSON.stringify({ items: [searchResult], nextCursor: null }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
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
      client.searchObjects({
        limit: 10,
        objectType: "event",
        query: "launch",
        cursor: "cursor_position",
      }),
    ).resolves.toEqual({ items: [searchResult], nextCursor: null });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/search?query=launch&cursor=cursor_position&limit=10&objectType=event",
    );
  });

  it("adds the active identity and workspace to protected requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [event],
          nextCursor: null,
          asOf: event.updatedAt,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const client = new ChronelleApiClient({
      baseUrl: "http://api.example.test/",
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });

    await expect(client.listEvents()).resolves.toEqual({
      items: [event],
      nextCursor: null,
      asOf: event.updatedAt,
    });
    const [url, request] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("http://api.example.test/api/events");
    expect(headers.get("authorization")).toBe("Bearer opaque-session");
    expect(headers.get("x-workspace-id")).toBe(event.workspaceId);
  });

  it("encodes event page positions and collection options", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ items: [], nextCursor: null, asOf: event.updatedAt }),
      );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });
    await client.listEvents({
      cursor: "opaque-position",
      limit: 7,
      query: "tea & cake",
      filter: "upcoming",
      sort: "name",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/events?cursor=opaque-position&limit=7&query=tea+%26+cake&filter=upcoming&sort=name",
    );
  });

  it("encodes relation filters and continuation while requiring page metadata", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [], nextCursor: "next_position" }),
      )
      .mockResolvedValueOnce(Response.json({ items: [] }));
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "opaque-session",
        workspaceId: event.workspaceId,
      }),
    });
    await expect(
      client.listObjectRelations(event.id, {
        cursor: "opaque_position",
        limit: 1,
        direction: "outgoing",
        relationType: "includes",
        otherObjectId: event.id,
      }),
    ).resolves.toEqual({ items: [], nextCursor: "next_position" });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/objects/${event.id}/relations?cursor=opaque_position&limit=1&direction=outgoing&relationType=includes&otherObjectId=${event.id}`,
    );
    await expect(client.listObjectRelations(event.id)).rejects.toThrow();
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

  it.each([
    "/api/document-transfers/upload/opaque-upload-token",
    "https://chronelle-test-1250000000.cos.ap-guangzhou.myqcloud.com/object?q-signature=test",
  ])("uploads to %s without forwarding the session", async (transferUrl) => {
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
              url: transferUrl,
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
      new URL(transferUrl, "https://chronelle.example").href,
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

  it.each([
    "/api/document-transfers/download/opaque-download-token",
    "https://chronelle-test-1250000000.cos.ap-guangzhou.myqcloud.com/object?q-signature=test",
  ])("downloads from %s after fresh authorization", async (transferUrl) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            download: {
              expiresAt: "2026-09-02T20:05:00.000Z",
              headers: {},
              method: "GET",
              url: transferUrl,
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
    expect(fetch.mock.calls[1]?.[0]).toBe(transferUrl);
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization"),
    ).toBeNull();
  });
});

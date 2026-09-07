import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  AuthorizationService,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objectRelations, resourceGrants, workspaces } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  developmentSignInResponseSchema,
  documentUploadAuthorizationResponseSchema,
  eventPlanningResourceResponseSchema,
  relationResponseSchema,
  shareResponseSchema,
} from "@chronelle/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

let database: TestDatabase;
let app: FastifyInstance;
let storageRoot: string;

beforeEach(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  storageRoot = await mkdtemp(resolve(tmpdir(), "chronelle-read-snapshot-"));
  app = buildApp(
    createDevelopmentAppDependencies(database.connection, {
      localStorageRoot: storageRoot,
    }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await database?.close();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName: "Planner" },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}
type Session = Awaited<ReturnType<typeof signIn>>;
const headers = (session: Session, workspaceId = session.workspace.id) => ({
  authorization: `Bearer ${session.accessToken}`,
  "x-workspace-id": workspaceId,
});

async function create(
  session: Session,
  collection = "events",
  fields: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${collection}`,
    headers: headers(session),
    payload: { displayName: "Shared content", ...fields },
  });
  expect(response.statusCode).toBe(201);
  return eventPlanningResourceResponseSchema.parse(response.json());
}

async function share(owner: Session, resourceId: string, role = "viewer") {
  const response = await app.inject({
    method: "POST",
    url: "/api/shares",
    headers: headers(owner),
    payload: { resourceId, principalEmail: "reader@example.com", role },
  });
  expect(response.statusCode).toBe(201);
  return shareResponseSchema.parse(response.json());
}

async function fixture(role = "viewer") {
  const owner = await signIn("owner@example.com");
  const reader = await signIn("reader@example.com");
  const event = await create(owner);
  const grant = await share(owner, event.id, role);
  return { owner, reader, event, grant };
}

async function revoke(owner: Session, grantId: string) {
  const response = await app.inject({
    method: "DELETE",
    url: `/api/shares/${grantId}`,
    headers: headers(owner),
  });
  expect(response.statusCode).toBe(200);
}

async function rename(owner: Session, collection: string, id: string) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/${collection}/${id}`,
    headers: headers(owner),
    payload: { expectedVersion: 1, displayName: "Private content" },
  });
  expect(response.statusCode).toBe(200);
}

/** Commit the writer after the real policy check, before the read resumes. */
function afterAuthorization(
  userId: string,
  resourceId: string,
  write: () => Promise<void>,
) {
  const canMany = AuthorizationService.prototype.canMany;
  let interleaved = false;
  vi.spyOn(AuthorizationService.prototype, "canMany").mockImplementation(
    async function (this: AuthorizationService, principal, action, resources) {
      const allowed = await canMany.call(this, principal, action, resources);
      if (
        !interleaved &&
        principal.userId === userId &&
        resources.some(
          (resource, index) => resource.id === resourceId && allowed[index],
        )
      ) {
        interleaved = true;
        await write();
      }
      return allowed;
    },
  );
  return () => expect(interleaved).toBe(true);
}

describe.sequential("authorized read snapshots", () => {
  it("keeps access actions consistent with the visible object", async () => {
    const { owner, reader, event, grant } = await fixture();
    const assertInterleaved = afterAuthorization(reader.user.id, event.id, () =>
      revoke(owner, grant.id),
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/access`,
      headers: headers(reader, owner.workspace.id),
    });
    assertInterleaved();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      resourceId: event.id,
      actions: ["view"],
    });
  });

  it("keeps event collection membership and content in one snapshot", async () => {
    const { owner, reader, event, grant } = await fixture();
    const assertInterleaved = afterAuthorization(
      reader.user.id,
      event.id,
      async () => {
        await revoke(owner, grant.id);
        await rename(owner, "events", event.id);
      },
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: headers(reader, owner.workspace.id),
    });
    assertInterleaved();
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toMatchObject([
      { id: event.id, version: 1, displayName: "Shared content" },
    ]);
  });

  it("keeps attachment traversal in the parent's authorized snapshot", async () => {
    const { owner, reader, event, grant } = await fixture();
    const bytes = Buffer.from("Private attachment bytes");
    const authorized = await app.inject({
      method: "POST",
      url: "/api/documents/upload-url",
      headers: headers(owner),
      payload: {
        parentObjectId: event.id,
        originalFilename: "attachment.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(authorized.statusCode).toBe(201);
    const upload = documentUploadAuthorizationResponseSchema.parse(
      authorized.json(),
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: upload.upload.url,
          headers: { "content-type": "application/octet-stream" },
          payload: bytes,
        })
      ).statusCode,
    ).toBe(204);
    const finalized = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: headers(owner),
      payload: { uploadAuthorizationId: upload.id },
    });
    expect(finalized.statusCode).toBe(201);
    const assertInterleaved = afterAuthorization(reader.user.id, event.id, () =>
      revoke(owner, grant.id),
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/documents`,
      headers: headers(reader, owner.workspace.id),
    });
    assertInterleaved();
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().lockedAttachmentCount).toBe(0);
  });

  it.each(["self-scope", "deleted-scope", "expired-grant"])(
    "filters endpoints after %s without stale policy",
    async (change) => {
      const { owner, reader, event, grant } = await fixture();
      const child = await create(owner, "tasks", {
        permissionScopeId: event.id,
      });
      await app.inject({
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        headers: headers(owner),
        payload: { relationType: "includes", targetObjectId: child.id },
      });
      const anchor = await create(owner);
      await share(owner, anchor.id);
      if (change === "self-scope") {
        expect(
          (
            await app.inject({
              method: "PATCH",
              url: `/api/objects/${child.id}/permission-scope`,
              headers: headers(owner),
              payload: { expectedVersion: 1, permissionScopeId: child.id },
            })
          ).statusCode,
        ).toBe(200);
      } else if (change === "deleted-scope") {
        expect(
          (
            await app.inject({
              method: "DELETE",
              url: `/api/objects/${event.id}?expectedVersion=1`,
              headers: headers(owner),
            })
          ).statusCode,
        ).toBe(200);
      } else {
        await database.connection.db
          .update(resourceGrants)
          .set({
            createdAt: new Date("1999-01-01T00:00:00Z"),
            expiresAt: new Date("2000-01-01T00:00:00Z"),
          })
          .where(eq(resourceGrants.id, grant.id));
      }
      const readerHeaders = headers(reader, owner.workspace.id);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/objects/${child.id}`,
            headers: readerHeaders,
          })
        ).statusCode,
      ).toBe(404);
      const search = await app.inject({
        method: "GET",
        url: "/api/search?query=Shared&objectType=task",
        headers: readerHeaders,
      });
      expect(search.statusCode).toBe(200);
      expect(search.json().items).toEqual([]);
      const detail = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/detail`,
        headers: readerHeaders,
      });
      if (change === "self-scope") {
        expect(detail.statusCode).toBe(200);
        expect(detail.json()).toMatchObject({
          tasks: [],
          lockedRelationCount: 1,
        });
        const relations = await app.inject({
          method: "GET",
          url: `/api/objects/${event.id}/relations`,
          headers: readerHeaders,
        });
        expect(relations.json().items).toEqual([]);
      } else {
        expect(detail.statusCode).toBe(404);
      }
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/objects/${child.id}`,
            headers: headers(reader),
          })
        ).statusCode,
      ).toBe(404);
    },
  );

  it("does not combine earlier workspace access with a later workspace name", async () => {
    const { owner, reader, grant } = await fixture();
    const canAccess = AuthorizationService.prototype.canAccessWorkspace;
    let interleaved = false;
    vi.spyOn(
      AuthorizationService.prototype,
      "canAccessWorkspace",
    ).mockImplementation(async function (
      this: AuthorizationService,
      userId,
      workspaceId,
    ) {
      const allowed = await canAccess.call(this, userId, workspaceId);
      if (
        !interleaved &&
        userId === reader.user.id &&
        workspaceId === owner.workspace.id
      ) {
        interleaved = true;
        await revoke(owner, grant.id);
        await database.connection.db
          .update(workspaces)
          .set({ displayName: "Private workspace name" })
          .where(eq(workspaces.id, workspaceId));
      }
      return allowed;
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: headers(reader, owner.workspace.id),
    });
    expect(interleaved).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.json().workspace.displayName).toBe(
      owner.workspace.displayName,
    );
    expect(
      response
        .json()
        .availableWorkspaces.map((workspace: { id: string }) => workspace.id),
    ).not.toContain(owner.workspace.id);
  });

  it.each(["objects", "events"])(
    "keeps %s content at the version authorized before revocation",
    async (collection) => {
      const { owner, reader, event, grant } = await fixture();
      const assertInterleaved = afterAuthorization(
        reader.user.id,
        event.id,
        async () => {
          await revoke(owner, grant.id);
          await rename(owner, "events", event.id);
        },
      );
      const response = await app.inject({
        method: "GET",
        url: `/api/${collection}/${event.id}`,
        headers: headers(reader, owner.workspace.id),
      });
      assertInterleaved();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: event.id,
        version: 1,
        displayName: "Shared content",
      });
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/${collection}/${event.id}`,
            headers: headers(reader, owner.workspace.id),
          })
        ).statusCode,
      ).toBe(404);
    },
  );

  it.each(["detail", "calendar", "itinerary", "timeline"])(
    "keeps the %s projection in its parent's authorized snapshot",
    async (projection) => {
      const { owner, reader, event, grant } = await fixture();
      const child = await create(owner, "events", {
        permissionScopeId: event.id,
        startsAt: "2030-10-01T12:00:00Z",
      });
      const linked = await app.inject({
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        headers: headers(owner),
        payload: { relationType: "includes", targetObjectId: child.id },
      });
      expect(linked.statusCode).toBe(201);
      const assertInterleaved = afterAuthorization(
        reader.user.id,
        event.id,
        async () => {
          await revoke(owner, grant.id);
          await rename(owner, "events", child.id);
        },
      );
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${projection}`,
        headers: headers(reader, owner.workspace.id),
      });
      assertInterleaved();
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(projection === "detail" ? body.events : body.items).toMatchObject([
        { displayName: "Shared content", version: 1 },
      ]);
    },
  );

  it("keeps relation metadata in the authorized snapshot", async () => {
    const { owner, reader, event, grant } = await fixture();
    const child = await create(owner);
    await share(owner, child.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/objects/${event.id}/relations`,
      headers: headers(owner),
      payload: {
        relationType: "includes",
        targetObjectId: child.id,
        metadata: { note: "Shared note" },
      },
    });
    const relation = relationResponseSchema.parse(response.json());
    const assertInterleaved = afterAuthorization(
      reader.user.id,
      event.id,
      async () => {
        await revoke(owner, grant.id);
        await database.connection.db
          .update(objectRelations)
          .set({ metadata: { note: "Private note" }, version: 2 })
          .where(eq(objectRelations.id, relation.id));
      },
    );
    const listed = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/relations`,
      headers: headers(reader, owner.workspace.id),
    });
    assertInterleaved();
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toMatchObject([
      { id: relation.id, metadata: { note: "Shared note" } },
    ]);
  });

  it("does not reveal grants added after the reader loses ownership", async () => {
    const { owner, reader, event, grant } = await fixture("owner");
    await signIn("additional@example.com");
    const assertInterleaved = afterAuthorization(
      reader.user.id,
      event.id,
      async () => {
        await revoke(owner, grant.id);
        const response = await app.inject({
          method: "POST",
          url: "/api/shares",
          headers: headers(owner),
          payload: {
            resourceId: event.id,
            principalEmail: "additional@example.com",
            role: "viewer",
          },
        });
        expect(response.statusCode).toBe(201);
      },
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/shares`,
      headers: headers(reader, owner.workspace.id),
    });
    assertInterleaved();
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toMatchObject([
      { id: grant.id, principal: { email: "reader@example.com" } },
    ]);
    expect(response.json().items).toHaveLength(1);
  });

  it("does not authorize earlier private search content using a later grant", async () => {
    const { owner, reader } = await fixture();
    const privateEvent = await create(owner, "events", {
      displayName: "Confidential search content",
    });
    const canMany = AuthorizationService.prototype.canMany;
    let interleaved = false;
    vi.spyOn(AuthorizationService.prototype, "canMany").mockImplementation(
      async function (
        this: AuthorizationService,
        principal: UserPrincipal,
        action,
        resources,
      ) {
        if (
          !interleaved &&
          principal.userId === reader.user.id &&
          resources.some((resource) => resource.id === privateEvent.id)
        ) {
          interleaved = true;
          await rename(owner, "events", privateEvent.id);
          await share(owner, privateEvent.id);
        }
        return canMany.call(this, principal, action, resources);
      },
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/search?query=Confidential",
      headers: headers(reader, owner.workspace.id),
    });
    expect(interleaved).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });
});

import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  sessionResponseSchema,
} from "@chronelle/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  createAppDependencies,
  createDevelopmentAppDependencies,
} from "../src/dependencies.js";
import type { AuthProvider } from "../src/authentication/auth-provider.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let testDatabase: TestDatabase;
let app: FastifyInstance;
let testResourcesReady = false;

beforeEach(async () => {
  testResourcesReady = false;
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  app = buildApp(createDevelopmentAppDependencies(testDatabase.connection));
  testResourcesReady = true;
});

afterEach(async () => {
  if (testResourcesReady) {
    await app.close();
    await testDatabase.close();
  }
  testResourcesReady = false;
});

async function signIn(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

describe.sequential("development authentication API", () => {
  it("creates one personal workspace during concurrent first sign-in", async () => {
    const sessions = await Promise.all([
      signIn("owner@example.com", "Workspace Owner"),
      signIn("owner@example.com", "Workspace Owner"),
      signIn("owner@example.com", "Workspace Owner"),
    ]);

    expect(new Set(sessions.map(({ user }) => user.id)).size).toBe(1);
    expect(new Set(sessions.map(({ workspace }) => workspace.id)).size).toBe(1);

    const persistedUsers = await testDatabase.connection.db
      .select()
      .from(users);
    const persistedWorkspaces = await testDatabase.connection.db
      .select()
      .from(workspaces);
    const persistedMemberships = await testDatabase.connection.db
      .select()
      .from(workspaceMembers);
    const persistedAuditEvents = await testDatabase.connection.db
      .select()
      .from(auditEvents);

    expect(persistedUsers).toHaveLength(1);
    expect(persistedWorkspaces).toHaveLength(1);
    expect(persistedMemberships).toMatchObject([{ role: "owner" }]);
    expect(persistedAuditEvents).toHaveLength(3);
    expect(persistedAuditEvents.map(({ action }) => action).sort()).toEqual([
      "identity.signed_in",
      "identity.signed_in",
      "workspace.personal_created",
    ]);
    expect(
      new Set(persistedAuditEvents.map(({ requestId }) => requestId)).size,
    ).toBe(3);
    expect(
      persistedAuditEvents.every(
        ({ actorId, actorType, resourceId, workspaceId }) =>
          actorType === "user" &&
          actorId === sessions[0]?.user.id &&
          resourceId === null &&
          workspaceId === sessions[0]?.workspace.id,
      ),
    ).toBe(true);
  });

  it("resolves the default session and rejects missing credentials", async () => {
    const signedIn = await signIn("session@example.com", "Session User");
    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${signedIn.accessToken}` },
    });
    const missingCredentialResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponseSchema.parse(sessionResponse.json())).toMatchObject({
      principal: {
        userId: signedIn.user.id,
        workspaceId: signedIn.workspace.id,
      },
    });
    expect(missingCredentialResponse.statusCode).toBe(401);
    expect(
      apiErrorResponseSchema.parse(missingCredentialResponse.json()),
    ).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("rejects malformed sign-in input with the public error contract", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/development/sign-in",
      payload: { displayName: "", email: "not-an-email" },
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
    });
  });

  it("accepts a replacement provider without exposing development sign-in", async () => {
    const dependencies = createDevelopmentAppDependencies(
      testDatabase.connection,
    );
    const identity = {
      provider: "replacement",
      subject: "replacement-user",
      displayName: "Replacement User",
      email: "replacement@example.com",
    };
    await dependencies.identity.signIn(identity, createId());
    const replacementProvider: AuthProvider = {
      authenticate: async (accessToken) =>
        accessToken === "replacement-token" ? identity : null,
    };

    await app.close();
    app = buildApp(
      createAppDependencies(testDatabase.connection, replacementProvider),
    );

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: "Bearer replacement-token" },
    });
    const developmentSignInResponse = await app.inject({
      method: "POST",
      url: "/api/auth/development/sign-in",
      payload: {
        displayName: "Unavailable",
        email: "unavailable@example.com",
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(developmentSignInResponse.statusCode).toBe(404);
  });

  it("selects a shared workspace only while an active grant exists", async () => {
    const viewer = await signIn("viewer@example.com", "Viewer");
    const owner = await signIn("shared-owner@example.com", "Shared Owner");
    const eventId = createId();
    await testDatabase.connection.db.insert(objects).values({
      id: eventId,
      workspaceId: owner.workspace.id,
      objectType: "event",
      displayName: "Shared event",
      createdBy: owner.user.id,
      permissionScopeId: eventId,
    });
    await testDatabase.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: owner.workspace.id,
      resourceId: eventId,
      principalId: viewer.user.id,
      role: "viewer",
      grantedBy: owner.user.id,
    });

    const sharedSessionResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        authorization: `Bearer ${viewer.accessToken}`,
        "x-workspace-id": owner.workspace.id,
      },
    });

    expect(sharedSessionResponse.statusCode).toBe(200);
    expect(
      sessionResponseSchema.parse(sharedSessionResponse.json()),
    ).toMatchObject({
      principal: {
        userId: viewer.user.id,
        workspaceId: owner.workspace.id,
      },
    });

    await testDatabase.connection.db
      .update(resourceGrants)
      .set({
        createdAt: new Date("1999-01-01T00:00:00Z"),
        expiresAt: new Date("2000-01-01T00:00:00Z"),
      })
      .where(eq(resourceGrants.resourceId, eventId));
    const expiredGrantResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        authorization: `Bearer ${viewer.accessToken}`,
        "x-workspace-id": owner.workspace.id,
      },
    });

    expect(expiredGrantResponse.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(expiredGrantResponse.json())).toEqual({
      error: {
        code: "workspace_unavailable",
        message: "The requested workspace is unavailable.",
      },
    });
  });

  it("returns the same response for inaccessible and nonexistent workspaces", async () => {
    const first = await signIn("first@example.com", "First User");
    const second = await signIn("second@example.com", "Second User");
    const headers = { authorization: `Bearer ${first.accessToken}` };

    const inaccessibleResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { ...headers, "x-workspace-id": second.workspace.id },
    });
    const nonexistentResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { ...headers, "x-workspace-id": createId() },
    });

    expect(inaccessibleResponse.statusCode).toBe(404);
    expect(nonexistentResponse.statusCode).toBe(404);
    expect(inaccessibleResponse.json()).toEqual(nonexistentResponse.json());
  });
});

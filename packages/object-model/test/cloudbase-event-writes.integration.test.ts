import { resolve } from "node:path";

import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  CloudBaseRpcError,
  createId,
  events,
  objectRevisions,
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
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseEventWriteRepository } from "../src/cloudbase-event-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type {
  CreateEventInput,
  EventResource,
  MutationContext,
  UpdateEventInput,
} from "../src/types.js";

// The Event write functions of migration 0012 must produce what the
// PostgreSQL service produces. Both backends run against one database here;
// the gateway transport is covered by the rpc contract harness on staging.

let database: TestDatabase;
let workspaceId: string;
let ownerId: string;
let viewerId: string;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;

const gatewayStatus: Record<string, number> = {
  PT403: 403,
  PT409: 409,
  PT422: 422,
  PT500: 500,
};

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  const db = database.connection.db;
  const sql = database.connection.sql;
  ownerId = createId();
  viewerId = createId();
  workspaceId = createId();
  await db.insert(users).values(
    [ownerId, viewerId].map((id) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName: "Write principal",
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "Event writes",
  });
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: ownerId,
    role: "owner",
  });

  // Executes the function locally with the gateway's error shape.
  const localRpc = {
    async rpc<T>(functionName: string, args: Record<string, unknown> = {}) {
      const names = Object.keys(args);
      // Objects travel as JSON text, which PostgreSQL casts to the jsonb parameter.
      const values = Object.values(args).map((value) =>
        value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value,
      );
      try {
        const [row] = await sql.unsafe<{ result: T }[]>(
          `SELECT ${functionName}(${names
            .map((name, index) => `${name} => $${index + 1}`)
            .join(", ")}) AS result`,
          values as never[],
        );
        return row?.result as T;
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        const code = failure.code ?? "unknown";
        throw new CloudBaseRpcError(
          gatewayStatus[code] ?? 400,
          `DATABASE_${code}`,
          failure.message ?? "function failed",
        );
      }
    },
  };
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(
    db,
    undefined,
    undefined,
    new CloudBaseEventWriteRepository(localRpc),
  );
});

afterAll(async () => {
  await database?.close();
});

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

function context(userId = ownerId, command?: MutationContext["command"]) {
  return {
    principal: { type: "user" as const, userId, workspaceId },
    requestId: createId(),
    ...(command !== undefined && { command }),
  };
}

/** Everything but identity and clock fields; scope is compared as "owns its scope". */
function shape(resource: EventResource) {
  const { id, createdAt, updatedAt, permissionScopeId, ...rest } = resource;
  return {
    ...rest,
    ownsScope: permissionScopeId === id,
    clockFields: [createdAt, updatedAt].every(
      (value) => value instanceof Date && Number.isFinite(value.getTime()),
    ),
  };
}

async function ledger(objectId: string) {
  const rows = await database.connection.db
    .select({
      snapshot: objectRevisions.snapshot,
      mutationKind: objectRevisions.mutationKind,
      action: auditEvents.action,
      metadata: auditEvents.metadata,
    })
    .from(objectRevisions)
    .innerJoin(auditEvents, eq(auditEvents.id, objectRevisions.auditEventId))
    .where(
      and(
        eq(objectRevisions.workspaceId, workspaceId),
        eq(objectRevisions.objectId, objectId),
      ),
    )
    .orderBy(objectRevisions.objectVersion);
  return rows.map(({ snapshot, metadata, ...entry }) => {
    const { id, createdAt, updatedAt, permissionScopeId, ...fields } =
      snapshot as Record<string, unknown>;
    const { permissionScopeId: scope, ...auditMetadata } = metadata as Record<
      string,
      unknown
    >;
    return {
      ...entry,
      snapshot: fields,
      snapshotOwnsScope: permissionScopeId === id,
      snapshotClockFields: [createdAt, updatedAt].every(
        (value) => typeof value === "string" && /\.\d{3}Z$/u.test(value),
      ),
      metadata: auditMetadata,
      metadataScopeMatches: scope === undefined || scope === id,
    };
  });
}

async function failure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to fail");
}

describe.sequential("CloudBase Event writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: EventResource[] = [];
    const updated: EventResource[] = [];
    for (const [, service] of backends()) {
      const parent = await service.createEvent(context(), {
        displayName: "Launch night",
        startsAt: new Date("2030-10-16T18:00:00.000Z"),
        endsAt: new Date("2030-10-16T23:00:00.000Z"),
        timezone: "Asia/Shanghai",
        isAllDay: false,
        customProperties: { theme: "gold", capacity: 120 },
        metadata: { source: "test" },
      });
      const child = await service.createEvent(context(), {
        displayName: "Venue walkthrough",
        startsOn: "2030-10-10",
        endsOn: "2030-10-11",
        permissionScopeId: parent.id,
      });
      expect(child.permissionScopeId).toBe(parent.id);
      created.push(parent, child);
      updated.push(
        await service.updateEvent(
          context(ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          parent.id,
          {
            expectedVersion: 1,
            displayName: "Launch night, moved",
            startsAt: null,
            endsAt: null,
            timezone: null,
            startsOn: "2030-10-17",
            isAllDay: true,
            customProperties: { theme: "silver" },
            metadata: {},
          },
        ),
      );
    }

    const [pgParent, pgChild, cbParent, cbChild] = created;
    expect(shape(cbParent as EventResource)).toEqual(
      shape(pgParent as EventResource),
    );
    expect(shape(cbChild as EventResource)).toEqual(
      shape(pgChild as EventResource),
    );
    const [pgUpdated, cbUpdated] = updated;
    expect(shape(cbUpdated as EventResource)).toEqual(
      shape(pgUpdated as EventResource),
    );
    expect(cbUpdated?.version).toBe(2);
    expect(cbUpdated?.startsOn).toBe("2030-10-17");
    expect(cbUpdated?.startsAt).toBeNull();

    expect(await ledger((cbParent as EventResource).id)).toEqual(
      await ledger((pgParent as EventResource).id),
    );
    expect(await ledger((cbChild as EventResource).id)).toEqual(
      await ledger((pgChild as EventResource).id),
    );
    expect(await ledger((cbParent as EventResource).id)).toHaveLength(2);
  });

  it("reject the same inputs with the same errors", async () => {
    const invalidCreates: CreateEventInput[] = [
      { displayName: "x", endsOn: "2030-01-01" },
      {
        displayName: "x",
        startsOn: "2030-01-01",
        startsAt: new Date("2030-01-01T00:00:00Z"),
      },
      { displayName: "x", endsAt: new Date("2030-01-01T00:00:00Z") },
      {
        displayName: "x",
        startsAt: new Date("2030-01-02T00:00:00Z"),
        endsAt: new Date("2030-01-01T00:00:00Z"),
      },
      { displayName: "x", timezone: "Mars/Olympus" },
    ];
    const invalidUpdates: Omit<UpdateEventInput, "expectedVersion">[] = [
      { endsAt: new Date("2030-01-01T00:00:00Z") },
      { startsOn: "2030-01-01" },
      { endsOn: "2030-01-01" },
      { timezone: "Not/AZone" },
    ];

    const outcomes: string[][] = [];
    for (const [, service] of backends()) {
      const seen: string[] = [];
      for (const input of invalidCreates) {
        const error = await failure(() =>
          service.createEvent(context(), input),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      const timed = await service.createEvent(context(), {
        displayName: "Guarded",
        startsAt: new Date("2030-03-01T09:00:00Z"),
        timezone: "UTC",
      });
      for (const changes of invalidUpdates) {
        const error = await failure(() =>
          service.updateEvent(context(), timed.id, {
            expectedVersion: 1,
            ...changes,
          }),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      expect(
        await failure(() =>
          service.updateEvent(context(), timed.id, {
            expectedVersion: 2,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updateEvent(context(viewerId), timed.id, {
            expectedVersion: 1,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.updateEvent(context(), createId(), {
            expectedVersion: 1,
            displayName: "missing",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createEvent(context(viewerId), { displayName: "denied" }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(await ledger(timed.id)).toHaveLength(1);

      await database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId,
        resourceId: timed.id,
        principalId: viewerId,
        role: "editor",
        grantedBy: ownerId,
      });
      const byGrantee = await service.updateEvent(context(viewerId), timed.id, {
        expectedVersion: 1,
        displayName: "by grantee",
      });
      expect(byGrantee.version).toBe(2);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toHaveLength(
      invalidCreates.length + invalidUpdates.length,
    );
  });

  it("refuse to update an object without a revision baseline", async () => {
    const messages: string[] = [];
    for (const [, service] of backends()) {
      const legacyId = createId();
      await database.connection.db.insert(objects).values({
        id: legacyId,
        workspaceId,
        permissionScopeId: legacyId,
        objectType: "event",
        displayName: "Legacy",
        createdBy: ownerId,
      });
      await database.connection.db.insert(events).values({
        objectId: legacyId,
        workspaceId,
      });
      const error = await failure(() =>
        service.updateEvent(context(), legacyId, {
          expectedVersion: 1,
          displayName: "Legacy v2",
        }),
      );
      messages.push(error.message);
    }
    expect(messages[1]).toBe(messages[0]);
    expect(messages[0]).toContain("Object revision baseline is missing");
  });
});

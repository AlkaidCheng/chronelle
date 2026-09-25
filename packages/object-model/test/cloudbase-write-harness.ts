import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  objectRevisions,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { and, eq } from "drizzle-orm";

import type { EventPlanningObjectService } from "../src/object-service.js";
import type { CanonicalObjectResource, MutationContext } from "../src/types.js";

// Shared setup for the differential write tests: one migrated database, a
// workspace with an owner and a non-member, and an rpc double that executes
// the write functions locally with the gateway's error shape. The gateway
// transport itself is covered by the rpc contract harness on staging.

export interface WriteHarness {
  readonly database: TestDatabase;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly viewerId: string;
  readonly rpc: <T>(
    functionName: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
}

export async function createWriteHarness(
  workspaceName: string,
): Promise<WriteHarness> {
  const database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  const db = database.connection.db;
  const ownerId = createId();
  const viewerId = createId();
  const workspaceId = createId();
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
    displayName: workspaceName,
  });
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: ownerId,
    role: "owner",
  });

  const rpc = createCloudBaseRpcDouble(database.connection.sql);

  return { database, workspaceId, ownerId, viewerId, rpc };
}

export function mutationContext(
  harness: WriteHarness,
  userId = harness.ownerId,
  command?: MutationContext["command"],
): MutationContext {
  return {
    principal: {
      type: "user",
      userId,
      workspaceId: harness.workspaceId,
    },
    requestId: createId(),
    ...(command !== undefined && { command }),
  };
}

/** Labelled reference and CloudBase-backed services for a differential loop. */
export function backends(
  reference: EventPlanningObjectService,
  cloudbase: EventPlanningObjectService,
) {
  return [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;
}

/** Everything but identity and clock fields; scope is compared as "owns its scope". */
// The rank follows creation order, so two backends writing one database
// never agree on it; the shape leaves it out.
export function shape(resource: CanonicalObjectResource) {
  const {
    id,
    createdAt,
    updatedAt,
    permissionScopeId,
    rank: _rank,
    ...rest
  } = resource as CanonicalObjectResource & { rank?: string };
  return {
    ...rest,
    ownsScope: permissionScopeId === id,
    clockFields: [createdAt, updatedAt].every(
      (value) => value instanceof Date && Number.isFinite(value.getTime()),
    ),
  };
}

/** The audit and revision rows of one object, with identity and clock fields normalised. */
export async function ledger(harness: WriteHarness, objectId: string) {
  const rows = await harness.database.connection.db
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
        eq(objectRevisions.workspaceId, harness.workspaceId),
        eq(objectRevisions.objectId, objectId),
      ),
    )
    .orderBy(objectRevisions.objectVersion);
  return rows.map(({ snapshot, metadata, ...entry }) => {
    const {
      id,
      createdAt,
      updatedAt,
      permissionScopeId,
      rank: _rank,
      ...fields
    } = snapshot as Record<string, unknown>;
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

export async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to fail");
}

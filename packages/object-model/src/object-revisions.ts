import {
  auditEvents,
  createId,
  objectRevisions,
  type ActorType,
  type DatabaseTransaction,
  type RevisionKind,
} from "@livtales/db";
import { and, eq } from "drizzle-orm";

import { serializeResource } from "./serialization.js";
import type { EventPlanningResource } from "./types.js";

interface RevisionActor {
  readonly actorId: string | null;
  readonly actorType: ActorType;
  readonly requestId: string;
}

/** Append the typed snapshot and its audit event within the live mutation transaction. */
export async function recordObjectRevision<
  Resource extends EventPlanningResource,
>(
  transaction: DatabaseTransaction,
  resource: Resource,
  actor: RevisionActor,
  mutationKind: RevisionKind,
  metadata: Record<string, unknown> = {},
  sourceRevisionId: string | null = null,
): Promise<Resource> {
  if (mutationKind !== "created" && mutationKind !== "baseline") {
    const [previous] = await transaction
      .select({ id: objectRevisions.id })
      .from(objectRevisions)
      .where(
        and(
          eq(objectRevisions.workspaceId, resource.workspaceId),
          eq(objectRevisions.objectId, resource.id),
          eq(objectRevisions.objectVersion, resource.version - 1),
        ),
      )
      .limit(1);
    if (previous === undefined) {
      throw new Error(
        "Object revision baseline is missing; run db:baseline-revisions before serving writes.",
      );
    }
  }

  const auditEventId = createId();
  const action =
    mutationKind === "baseline"
      ? "object.baselined"
      : mutationKind === "permission_scope_updated"
        ? "object.permission_scope_updated"
        : `${resource.objectType}.${mutationKind}`;
  const [audit] = await transaction
    .insert(auditEvents)
    .values({
      id: auditEventId,
      workspaceId: resource.workspaceId,
      ...actor,
      action,
      resourceId: resource.id,
      metadata: {
        ...metadata,
        version: resource.version,
        ...(sourceRevisionId !== null && { sourceRevisionId }),
      },
    })
    .returning({ createdAt: auditEvents.createdAt });
  if (audit === undefined)
    throw new Error("The revision audit event was not recorded.");

  await transaction.insert(objectRevisions).values({
    id: createId(),
    workspaceId: resource.workspaceId,
    objectId: resource.id,
    objectVersion: resource.version,
    mutationKind,
    sourceRevisionId,
    ...actor,
    auditEventId,
    snapshotSchemaVersion: 1,
    snapshot: {
      ...serializeResource(resource),
      ...(resource.objectType === "document" && {
        storageKey: resource.storageKey,
      }),
    },
    createdAt: audit.createdAt,
  });
  return resource;
}

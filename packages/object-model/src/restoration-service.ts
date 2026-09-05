import {
  AuthorizationDeniedError,
  AuthorizationService,
  DrizzleAuthorizationStore,
  withStableAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  events,
  tasks,
  reminders,
  objects,
  objectRevisions,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import {
  revisionSnapshotSchema,
  eventUpdateRequestSchema,
  taskUpdateRequestSchema,
  reminderUpdateRequestSchema,
  type RevisionComparisonQuery,
  type RevisionRestoreRequest,
  type RevisionSnapshot,
} from "@chronelle/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";

import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import { readObjectState } from "./object-state.js";
import { recordObjectRevision } from "./object-revisions.js";
import {
  compareRevisionContent,
  preservedRevisionFields,
  selectRestorableContent,
} from "./restoration-policy.js";
import { serializeResource } from "./serialization.js";
import type { MutationContext } from "./types.js";

async function readRevision(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
  objectId: string,
  version: number,
) {
  const [revision] = await transaction
    .select({
      id: objectRevisions.id,
      snapshot: objectRevisions.snapshot,
      schemaVersion: objectRevisions.snapshotSchemaVersion,
    })
    .from(objectRevisions)
    .where(
      and(
        eq(objectRevisions.workspaceId, principal.workspaceId),
        eq(objectRevisions.objectId, objectId),
        eq(objectRevisions.objectVersion, version),
      ),
    )
    .limit(1);
  if (revision === undefined) throw new AuthorizationDeniedError();
  if (revision.schemaVersion !== 1)
    throw new InvalidObjectStateError(
      "The revision snapshot schema is not supported.",
    );
  return {
    id: revision.id,
    snapshot: revisionSnapshotSchema.parse(revision.snapshot),
  };
}

export class ObjectRestorationService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async compare(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionComparisonQuery,
  ) {
    return this.#readAuthorized(principal, objectId, async (transaction) => {
      const before = await readRevision(
        transaction,
        principal,
        objectId,
        input.fromVersion,
      );
      const after = await readRevision(
        transaction,
        principal,
        objectId,
        input.toVersion,
      );
      return {
        objectId,
        ...input,
        changes: compareRevisionContent(before.snapshot, after.snapshot),
      };
    });
  }

  async preview(principal: UserPrincipal, objectId: string, version: number) {
    return this.#readAuthorized(
      principal,
      objectId,
      async (transaction, authorization) => {
        const current = revisionSnapshotSchema.parse(
          serializeResource(
            await readObjectState(transaction, principal.workspaceId, objectId),
          ),
        );
        const source = await readRevision(
          transaction,
          principal,
          objectId,
          version,
        );
        const changes = compareRevisionContent(current, source.snapshot);
        return {
          objectId,
          sourceRevisionId: source.id,
          sourceVersion: version,
          currentVersion: current.version,
          changes,
          preservedFields: preservedRevisionFields(current.objectType),
          canRestore:
            source.snapshot.deletedAt === null &&
            changes.some((change) => change.restorable) &&
            (await authorization.can(principal, "edit", {
              id: objectId,
              workspaceId: principal.workspaceId,
            })),
        };
      },
    );
  }

  /** Apply historical content as a new live version, preserving current security and immutable facts. */
  async restore(
    context: MutationContext,
    objectId: string,
    version: number,
    input: RevisionRestoreRequest,
  ) {
    const { principal } = context;
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "edit", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const current = await readObjectState(
          transaction,
          principal.workspaceId,
          objectId,
        );
        if (current.version !== input.expectedVersion)
          throw new ObjectConflictError();
        const source = await readRevision(
          transaction,
          principal,
          objectId,
          version,
        );
        if (source.snapshot.deletedAt !== null)
          throw new InvalidObjectStateError(
            "A deleted state cannot be restored through content history.",
          );
        const changes = compareRevisionContent(
          revisionSnapshotSchema.parse(serializeResource(current)),
          source.snapshot,
        );
        if (!changes.some((change) => change.restorable))
          throw new InvalidObjectStateError(
            "This revision has no restorable content changes.",
          );
        const content = selectRestorableContent(source.snapshot);
        const [updated] = await transaction
          .update(objects)
          .set({
            displayName: source.snapshot.displayName,
            customProperties: source.snapshot.customProperties,
            updatedAt: new Date(),
            version: sql`${objects.version} + 1`,
          })
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              eq(objects.id, objectId),
              eq(objects.version, input.expectedVersion),
              isNull(objects.deletedAt),
            ),
          )
          .returning({ id: objects.id });
        if (updated === undefined) throw new ObjectConflictError();
        await this.#restoreTypedContent(
          transaction,
          principal.workspaceId,
          objectId,
          source.snapshot,
          content,
        );
        return recordObjectRevision(
          transaction,
          await readObjectState(transaction, principal.workspaceId, objectId),
          {
            actorId: principal.userId,
            actorType: "user",
            requestId: context.requestId,
          },
          "restored",
          { previousVersion: current.version, sourceVersion: version },
          source.id,
        );
      },
    );
  }

  async #restoreTypedContent(
    transaction: DatabaseTransaction,
    workspaceId: string,
    objectId: string,
    source: RevisionSnapshot,
    content: Record<string, unknown>,
  ) {
    switch (source.objectType) {
      case "event": {
        const fields = eventUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        await transaction
          .update(events)
          .set({
            startsAt: fields.startsAt,
            endsAt: fields.endsAt,
            timezone: fields.timezone,
            isAllDay: fields.isAllDay,
          })
          .where(
            and(
              eq(events.workspaceId, workspaceId),
              eq(events.objectId, objectId),
            ),
          );
        break;
      }
      case "task": {
        const fields = taskUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        await transaction
          .update(tasks)
          .set({
            status: fields.status,
            dueAt: fields.dueAt,
            completedAt: fields.completedAt,
          })
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.objectId, objectId),
            ),
          );
        break;
      }
      case "reminder": {
        const fields = reminderUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        await transaction
          .update(reminders)
          .set({ remindAt: fields.remindAt })
          .where(
            and(
              eq(reminders.workspaceId, workspaceId),
              eq(reminders.objectId, objectId),
            ),
          );
        break;
      }
      case "expense":
      case "document":
        break;
    }
  }

  async #readAuthorized<Value>(
    principal: UserPrincipal,
    objectId: string,
    read: (
      transaction: DatabaseTransaction,
      authorization: AuthorizationService,
    ) => Promise<Value>,
  ) {
    return this.#database.transaction(
      async (transaction) => {
        const authorization = new AuthorizationService(
          new DrizzleAuthorizationStore(transaction),
        );
        await authorization.assertCan(principal, "view", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        return read(transaction, authorization);
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
}

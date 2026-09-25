import {
  withStableAuthorization,
  type UserPrincipal,
} from "@livtales/authorization";
import { objects, tasks, type Database } from "@livtales/db";
import type { RecoveryRequest, TrashQueryInput } from "@livtales/schemas";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type { ObjectLifecycleWriteRepository } from "./object-writes.js";
import { readObjectState } from "./object-state.js";
import { recordObjectRevision } from "./object-revisions.js";
import {
  PostgresRecoveryReadRepository,
  recoveryBlockedReason,
  type RecoveryPreview,
  type RecoveryReadRepository,
  type TrashPage,
} from "./recovery-reads.js";
import type { MutationContext } from "./types.js";

/** Recover canonical tombstones without replaying content or changing relationships. */
export class ObjectRecoveryService {
  readonly #database: Database;
  readonly #reads: RecoveryReadRepository;
  readonly #writes: ObjectLifecycleWriteRepository | undefined;

  constructor(
    database: Database,
    reads?: RecoveryReadRepository,
    writes?: ObjectLifecycleWriteRepository,
  ) {
    this.#database = database;
    this.#reads = reads ?? new PostgresRecoveryReadRepository(database);
    this.#writes = writes;
  }

  list(
    principal: UserPrincipal,
    options: TrashQueryInput = {},
  ): Promise<TrashPage> {
    return this.#reads.listTrash(principal, options);
  }

  preview(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<RecoveryPreview> {
    return this.#reads.previewRecovery(principal, objectId);
  }

  async recover(
    context: MutationContext,
    objectId: string,
    input: RecoveryRequest,
  ) {
    const { principal } = context;
    if (this.#writes !== undefined)
      return this.#writes.recover(context, objectId, input.expectedVersion);
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "recover", {
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
        if (current.deletedAt === null)
          throw new InvalidObjectStateError("The object is not in Trash.");
        const blockedReason = await recoveryBlockedReason(
          transaction,
          principal.workspaceId,
          current.permissionScopeId,
          objectId,
        );
        if (blockedReason !== null)
          throw new InvalidObjectStateError(blockedReason);
        const [updated] = await transaction
          .update(objects)
          .set({
            deletedAt: null,
            deletedWith: null,
            updatedAt: new Date(),
            version: sql`${objects.version} + 1`,
          })
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              eq(objects.id, objectId),
              eq(objects.version, input.expectedVersion),
              isNotNull(objects.deletedAt),
            ),
          )
          .returning({ id: objects.id });
        if (updated === undefined) throw new ObjectConflictError();
        const actor = {
          actorType: "user" as const,
          actorId: principal.userId,
          requestId: context.requestId,
        };
        const recovered = await recordObjectRevision(
          transaction,
          await readObjectState(transaction, principal.workspaceId, objectId),
          actor,
          "recovered",
          {
            previousVersion: current.version,
            deletedAt: current.deletedAt.toISOString(),
          },
        );
        // The subtasks that went to Trash with the task come back with it;
        // those trashed on their own stay.
        if (current.objectType === "task") {
          const cascaded = await transaction
            .select({ id: objects.id, version: objects.version })
            .from(tasks)
            .innerJoin(
              objects,
              and(
                eq(objects.workspaceId, tasks.workspaceId),
                eq(objects.id, tasks.objectId),
              ),
            )
            .where(
              and(
                eq(tasks.workspaceId, principal.workspaceId),
                eq(tasks.parentTaskId, objectId),
                eq(objects.deletedWith, objectId),
              ),
            )
            .orderBy(objects.id);
          for (const subtask of cascaded) {
            await transaction
              .update(objects)
              .set({
                deletedAt: null,
                deletedWith: null,
                updatedAt: new Date(),
                version: sql`${objects.version} + 1`,
              })
              .where(
                and(
                  eq(objects.workspaceId, principal.workspaceId),
                  eq(objects.id, subtask.id),
                ),
              );
            await recordObjectRevision(
              transaction,
              await readObjectState(
                transaction,
                principal.workspaceId,
                subtask.id,
              ),
              actor,
              "recovered",
              {
                cascadeFrom: objectId,
                previousVersion: subtask.version,
                deletedAt: current.deletedAt.toISOString(),
              },
            );
          }
        }
        return recovered;
      },
    );
  }
}

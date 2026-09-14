import {
  withStableAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objects, type Database } from "@chronelle/db";
import type { RecoveryRequest, TrashQueryInput } from "@chronelle/schemas";
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
        return recordObjectRevision(
          transaction,
          await readObjectState(transaction, principal.workspaceId, objectId),
          {
            actorType: "user",
            actorId: principal.userId,
            requestId: context.requestId,
          },
          "recovered",
          {
            previousVersion: current.version,
            deletedAt: current.deletedAt.toISOString(),
          },
        );
      },
    );
  }
}

import {
  AuthorizationDeniedError,
  type AuthorizationService,
  withStableAuthorization,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  commandChanges,
  objectRevisions,
  reversibleCommands,
  type Database,
  type DatabaseTransaction,
} from "@livtales/db";
import {
  commandEditSchema,
  revisionSnapshotSchema,
  type CommandEdit,
  type CommandExecuteRequest,
  type CommandTransitionRequest,
  type CommandReceipt,
  type CommandStateResponse,
} from "@livtales/schemas";
import { and, eq } from "drizzle-orm";
import { hashCommand } from "./command-hash.js";
import {
  PostgresCommandReadRepository,
  type CommandReadRepository,
} from "./command-reads.js";
import {
  readCommandChanges,
  readCommandReceipt,
  readCommandStack,
  recordCommandReceipt,
  saveCommandStack,
} from "./command-store.js";
import { CommandStackConflictError, ObjectConflictError } from "./errors.js";
import { EventPlanningObjectService } from "./object-service.js";
import { readObjectState } from "./object-state.js";
import type { CommandWriteRepository } from "./object-writes.js";
import { selectRestorableContent } from "./restoration-policy.js";
import type { MutationContext } from "./types.js";

/**
 * Apply bounded content commands and inverses under current authorization
 * and version preconditions. The PostgreSQL implementation is this class's
 * own transactional code, used whenever no write repository is injected;
 * the state read comes from the read repository, PostgreSQL by default.
 */
export class ReversibleCommandService {
  readonly #writes: CommandWriteRepository | undefined;
  readonly #reads: CommandReadRepository;

  constructor(
    private readonly database: Database,
    writes?: CommandWriteRepository,
    reads?: CommandReadRepository,
  ) {
    this.#writes = writes;
    this.#reads = reads ?? new PostgresCommandReadRepository(database);
  }

  async getState(principal: UserPrincipal): Promise<CommandStateResponse> {
    return this.#reads.getState(principal);
  }

  async execute(
    context: MutationContext,
    input: CommandExecuteRequest,
  ): Promise<CommandReceipt> {
    if (this.#writes !== undefined) return this.#writes.execute(context, input);
    const requestHash = hashCommand({ direction: "execute", input });
    return withStableAuthorization(
      this.database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        const replay = await this.replay(
          transaction,
          authorization,
          context.principal,
          input.operationId,
          requestHash,
        );
        if (replay !== null) return replay;
        const stack = await readCommandStack(transaction, context.principal);
        if (stack.version !== input.expectedStackVersion)
          throw new CommandStackConflictError();
        const edits = [...input.edits].sort((a, b) =>
          a.objectId.localeCompare(b.objectId),
        );
        let hasDiverged = false;
        for (const edit of edits) {
          await authorization.assertCan(context.principal, "edit", {
            id: edit.objectId,
            workspaceId: context.principal.workspaceId,
          });
          const current = await readObjectState(
            transaction,
            context.principal.workspaceId,
            edit.objectId,
          );
          if (
            current.objectType !== edit.objectType ||
            current.deletedAt !== null
          )
            throw new AuthorizationDeniedError();
          if (current.version !== edit.patch.expectedVersion)
            throw new ObjectConflictError();
          const expected = stack.expectedVersions[edit.objectId];
          if (expected !== undefined && expected !== current.version)
            hasDiverged = true;
        }
        // A new command must not make an older inverse cross an intervening untracked edit.
        if (hasDiverged) {
          stack.undoIds = [];
          stack.expectedVersions = {};
        }
        stack.redoIds = [];
        const commandId = input.operationId;
        const commandContext = {
          ...context,
          command: {
            id: commandId,
            operationId: input.operationId,
            direction: "execute" as const,
          },
        };
        const versions = await this.applyEdits(
          transaction,
          authorization,
          commandContext,
          edits,
        );
        await transaction.insert(reversibleCommands).values({
          workspaceId: context.principal.workspaceId,
          userId: context.principal.userId,
          id: commandId,
        });
        await transaction.insert(commandChanges).values(
          edits.map((edit) => ({
            workspaceId: context.principal.workspaceId,
            userId: context.principal.userId,
            commandId,
            objectId: edit.objectId,
            beforeVersion: edit.patch.expectedVersion,
            afterVersion: edit.patch.expectedVersion + 1,
          })),
        );
        stack.undoIds = [...stack.undoIds, commandId].slice(-50);
        Object.assign(
          stack.expectedVersions,
          Object.fromEntries(
            versions.map((object) => [object.id, object.version]),
          ),
        );
        await saveCommandStack(transaction, stack);
        return recordCommandReceipt(transaction, context, requestHash, {
          operationId: input.operationId,
          commandId,
          direction: "execute",
          stackVersion: stack.version + 1,
          objects: versions,
        });
      },
    );
  }

  async undo(
    context: MutationContext,
    input: CommandTransitionRequest,
  ): Promise<CommandReceipt> {
    return this.transition(context, input, "undo");
  }

  async redo(
    context: MutationContext,
    input: CommandTransitionRequest,
  ): Promise<CommandReceipt> {
    return this.transition(context, input, "redo");
  }

  private async transition(
    context: MutationContext,
    input: CommandTransitionRequest,
    direction: "undo" | "redo",
  ): Promise<CommandReceipt> {
    if (this.#writes !== undefined)
      return this.#writes.transition(context, input, direction);
    const requestHash = hashCommand({ direction, input });
    return withStableAuthorization(
      this.database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        const replay = await this.replay(
          transaction,
          authorization,
          context.principal,
          input.operationId,
          requestHash,
        );
        if (replay !== null) return replay;
        const stack = await readCommandStack(transaction, context.principal);
        const source = direction === "undo" ? stack.undoIds : stack.redoIds;
        const destination =
          direction === "undo" ? stack.redoIds : stack.undoIds;
        if (
          stack.version !== input.expectedStackVersion ||
          source.at(-1) !== input.commandId
        )
          throw new CommandStackConflictError();
        const changes = await readCommandChanges(
          transaction,
          context.principal,
          input.commandId,
        );
        const edits: CommandEdit[] = [];
        for (const change of changes) {
          await authorization.assertCan(context.principal, "edit", {
            id: change.objectId,
            workspaceId: context.principal.workspaceId,
          });
          const current = await readObjectState(
            transaction,
            context.principal.workspaceId,
            change.objectId,
          );
          if (current.deletedAt !== null) throw new AuthorizationDeniedError();
          if (current.version !== stack.expectedVersions[change.objectId])
            throw new ObjectConflictError();
          const sourceVersion =
            direction === "undo" ? change.beforeVersion : change.afterVersion;
          edits.push(
            await this.readContentEdit(
              transaction,
              context.principal,
              change.objectId,
              sourceVersion,
              current.version,
            ),
          );
        }
        const commandContext = {
          ...context,
          command: {
            id: input.commandId,
            operationId: input.operationId,
            direction,
          },
        };
        const versions = await this.applyEdits(
          transaction,
          authorization,
          commandContext,
          edits,
        );
        source.pop();
        destination.push(input.commandId);
        Object.assign(
          stack.expectedVersions,
          Object.fromEntries(
            versions.map((object) => [object.id, object.version]),
          ),
        );
        await saveCommandStack(transaction, stack);
        return recordCommandReceipt(transaction, context, requestHash, {
          operationId: input.operationId,
          commandId: input.commandId,
          direction,
          stackVersion: stack.version + 1,
          objects: versions,
        });
      },
    );
  }

  private async applyEdits(
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
    context: MutationContext,
    edits: CommandEdit[],
  ) {
    const objects = new EventPlanningObjectService({
      database: transaction,
      authorization,
    });
    const versions: CommandReceipt["objects"] = [];
    for (const edit of edits) {
      const resource =
        edit.objectType === "event"
          ? await objects.updateEvent(context, edit.objectId, edit.patch)
          : await objects.updateTask(context, edit.objectId, edit.patch);
      versions.push({ id: resource.id, version: resource.version });
    }
    return versions;
  }

  private async readContentEdit(
    transaction: DatabaseTransaction,
    principal: UserPrincipal,
    objectId: string,
    sourceVersion: number,
    expectedVersion: number,
  ): Promise<CommandEdit> {
    const [revision] = await transaction
      .select()
      .from(objectRevisions)
      .where(
        and(
          eq(objectRevisions.workspaceId, principal.workspaceId),
          eq(objectRevisions.objectId, objectId),
          eq(objectRevisions.objectVersion, sourceVersion),
        ),
      );
    if (revision === undefined || revision.snapshotSchemaVersion !== 1)
      throw new Error("Unsupported command revision.");
    const snapshot = revisionSnapshotSchema.parse(revision.snapshot);
    if (snapshot.deletedAt !== null)
      throw new Error("Command content must reference a live revision.");
    return commandEditSchema.parse({
      objectType: snapshot.objectType,
      objectId,
      patch: { ...selectRestorableContent(snapshot), expectedVersion },
    });
  }

  private async replay(
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
    principal: UserPrincipal,
    operationId: string,
    requestHash: string,
  ): Promise<CommandReceipt | null> {
    const receipt = await readCommandReceipt(
      transaction,
      principal,
      operationId,
      requestHash,
    );
    if (receipt === null) return null;
    for (const object of receipt.objects) {
      await authorization.assertCan(principal, "view", {
        id: object.id,
        workspaceId: principal.workspaceId,
      });
    }
    return receipt;
  }
}

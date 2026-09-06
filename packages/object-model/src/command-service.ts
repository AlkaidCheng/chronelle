import {
  AuthorizationDeniedError,
  AuthorizationService,
  DrizzleAuthorizationStore,
  withStableAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  commandChanges,
  objectRevisions,
  reversibleCommands,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import {
  commandEditSchema,
  revisionSnapshotSchema,
  type CommandEdit,
  type CommandExecuteRequest,
  type CommandTransitionRequest,
  type CommandReceipt,
  type CommandStateResponse,
} from "@chronelle/schemas";
import { and, eq } from "drizzle-orm";
import { hashCommand } from "./command-hash.js";
import {
  readCommandChanges,
  readCommandReceipt,
  readCommandStack,
  recordCommandReceipt,
  saveCommandStack,
  type CommandStack,
} from "./command-store.js";
import { CommandStackConflictError, ObjectConflictError } from "./errors.js";
import { EventPlanningObjectService } from "./object-service.js";
import { readObjectState } from "./object-state.js";
import { selectRestorableContent } from "./restoration-policy.js";
import type { MutationContext } from "./types.js";

/** Apply bounded content commands and inverses under current authorization and version preconditions. */
export class ReversibleCommandService {
  constructor(private readonly database: Database) {}

  async getState(principal: UserPrincipal): Promise<CommandStateResponse> {
    return this.database.transaction(
      async (transaction) => {
        const authorization = new AuthorizationService(
          new DrizzleAuthorizationStore(transaction),
        );
        const stack = await readCommandStack(transaction, principal);
        const redo = await this.readHead(
          transaction,
          authorization,
          principal,
          stack,
          stack.redoIds.at(-1),
        );
        return {
          version: stack.version,
          undo: await this.readHead(
            transaction,
            authorization,
            principal,
            stack,
            stack.undoIds.at(-1),
          ),
          redo: redo?.available ? redo : null,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async execute(
    context: MutationContext,
    input: CommandExecuteRequest,
  ): Promise<CommandReceipt> {
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
    const objects = new EventPlanningObjectService(transaction, authorization);
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

  private async readHead(
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
    principal: UserPrincipal,
    stack: CommandStack,
    commandId: string | undefined,
  ): Promise<CommandStateResponse["undo"]> {
    if (commandId === undefined) return null;
    const changes = await readCommandChanges(transaction, principal, commandId);
    let available = true;
    for (const change of changes) {
      if (
        !(await authorization.can(principal, "edit", {
          id: change.objectId,
          workspaceId: principal.workspaceId,
        }))
      )
        return null;
      const current = await readObjectState(
        transaction,
        principal.workspaceId,
        change.objectId,
      );
      if (current.version !== stack.expectedVersions[change.objectId])
        available = false;
    }
    return { commandId, available };
  }
}

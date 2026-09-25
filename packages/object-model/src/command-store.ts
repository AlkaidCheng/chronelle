import {
  auditEvents,
  commandChanges,
  commandReceipts,
  commandStacks,
  createId,
  type DatabaseTransaction,
} from "@livtales/db";
import type { UserPrincipal } from "@livtales/authorization";
import { commandReceiptSchema, type CommandReceipt } from "@livtales/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { CommandConflictError, CommandStackConflictError } from "./errors.js";
import type { MutationContext } from "./types.js";

export type CommandStack = typeof commandStacks.$inferSelect;

function stackScope(principal: UserPrincipal) {
  return and(
    eq(commandStacks.workspaceId, principal.workspaceId),
    eq(commandStacks.userId, principal.userId),
  );
}

export async function readCommandStack(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
): Promise<CommandStack> {
  const [stored] = await transaction
    .select()
    .from(commandStacks)
    .where(stackScope(principal));
  return (
    stored ?? {
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      version: 0,
      undoIds: [],
      redoIds: [],
      expectedVersions: {},
    }
  );
}

export async function readCommandChanges(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
  commandId: string,
) {
  const changes = await transaction
    .select()
    .from(commandChanges)
    .where(
      and(
        eq(commandChanges.workspaceId, principal.workspaceId),
        eq(commandChanges.userId, principal.userId),
        eq(commandChanges.commandId, commandId),
      ),
    )
    .orderBy(commandChanges.objectId);
  if (changes.length === 0) throw new CommandStackConflictError();
  return changes;
}

export async function readCommandReceipt(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
  operationId: string,
  requestHash: string,
): Promise<CommandReceipt | null> {
  const [stored] = await transaction
    .select()
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.workspaceId, principal.workspaceId),
        eq(commandReceipts.userId, principal.userId),
        eq(commandReceipts.operationId, operationId),
      ),
    );
  if (stored === undefined) return null;
  if (stored.requestHash !== requestHash) throw new CommandConflictError();
  return commandReceiptSchema.parse(stored.receipt);
}

/** Advance the stack and prune version expectations for commands outside its reachable history. */
export async function saveCommandStack(
  transaction: DatabaseTransaction,
  stack: CommandStack,
): Promise<void> {
  const retainedIds = [...stack.undoIds, ...stack.redoIds];
  const changes =
    retainedIds.length === 0
      ? []
      : await transaction
          .select({ objectId: commandChanges.objectId })
          .from(commandChanges)
          .where(
            and(
              eq(commandChanges.workspaceId, stack.workspaceId),
              eq(commandChanges.userId, stack.userId),
              inArray(commandChanges.commandId, retainedIds),
            ),
          );
  const retainedObjects = new Set(changes.map((change) => change.objectId));
  const expectedVersions = Object.fromEntries(
    Object.entries(stack.expectedVersions).filter(([id]) =>
      retainedObjects.has(id),
    ),
  );
  await transaction
    .insert(commandStacks)
    .values({ workspaceId: stack.workspaceId, userId: stack.userId })
    .onConflictDoNothing();
  const [updated] = await transaction
    .update(commandStacks)
    .set({
      version: stack.version + 1,
      undoIds: stack.undoIds,
      redoIds: stack.redoIds,
      expectedVersions,
    })
    .where(
      and(
        eq(commandStacks.workspaceId, stack.workspaceId),
        eq(commandStacks.userId, stack.userId),
        eq(commandStacks.version, stack.version),
      ),
    )
    .returning({ version: commandStacks.version });
  if (updated === undefined) throw new CommandStackConflictError();
}

export async function recordCommandReceipt(
  transaction: DatabaseTransaction,
  context: MutationContext,
  requestHash: string,
  receipt: CommandReceipt,
): Promise<CommandReceipt> {
  const auditEventId = createId();
  await transaction.insert(auditEvents).values({
    id: auditEventId,
    workspaceId: context.principal.workspaceId,
    actorType: "user",
    actorId: context.principal.userId,
    requestId: context.requestId,
    action: `command.${receipt.direction}`,
    metadata: receipt,
  });
  await transaction.insert(commandReceipts).values({
    workspaceId: context.principal.workspaceId,
    userId: context.principal.userId,
    operationId: receipt.operationId,
    commandId: receipt.commandId,
    requestHash,
    auditEventId,
    receipt,
  });
  return receipt;
}

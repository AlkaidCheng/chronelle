import { auditEvents, type ActorType } from "./schema.js";
import { createId } from "./ids.js";
import type { Database, DatabaseTransaction } from "./client.js";

export interface MutationAuditRecord {
  readonly action: string;
  readonly actorId: string | null;
  readonly actorType: ActorType;
  readonly metadata: Record<string, unknown>;
  readonly requestId: string;
  readonly resourceId: string | null;
  readonly workspaceId: string;
}

export interface AuditedMutationResult<Value> {
  readonly audit: MutationAuditRecord;
  readonly value: Value;
}

export async function runAuditedMutation<Value>(
  database: Database | DatabaseTransaction,
  mutation: (
    transaction: DatabaseTransaction,
  ) => Promise<AuditedMutationResult<Value>>,
): Promise<Value> {
  return database.transaction(async (transaction) => {
    const { audit, value } = await mutation(transaction);

    await transaction.insert(auditEvents).values({
      id: createId(),
      workspaceId: audit.workspaceId,
      actorType: audit.actorType,
      actorId: audit.actorId,
      action: audit.action,
      resourceId: audit.resourceId,
      requestId: audit.requestId,
      metadata: audit.metadata,
    });

    return value;
  });
}

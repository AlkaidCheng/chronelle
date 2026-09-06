import {
  workspaces,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import { eq } from "drizzle-orm";

import {
  AuthorizationDeniedError,
  AuthorizationService,
} from "./authorization.js";
import { DrizzleAuthorizationStore } from "./drizzle-authorization-store.js";

/** Order protected mutations within a workspace before evaluating current permissions. */
export async function withStableAuthorization<Value>(
  database: Database | DatabaseTransaction,
  workspaceId: string,
  operation: (
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
  ) => Promise<Value>,
): Promise<Value> {
  return database.transaction(async (transaction) => {
    const [workspace] = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("no key update");
    if (workspace === undefined) throw new AuthorizationDeniedError();
    return operation(
      transaction,
      new AuthorizationService(new DrizzleAuthorizationStore(transaction)),
    );
  });
}

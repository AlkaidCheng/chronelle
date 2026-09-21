import {
  workspaces,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import { eq, is } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";

import {
  AuthorizationDeniedError,
  AuthorizationService,
} from "./authorization.js";
import { DrizzleAuthorizationStore } from "./drizzle-authorization-store.js";
import { ReadSnapshotAuthorizationStore } from "./read-snapshot-authorization-store.js";

/** A transaction and its policy evaluator, owned by a snapshot or a protected mutation. */
export interface AuthorizedTransaction {
  readonly database: DatabaseTransaction;
  readonly authorization: AuthorizationService;
}

export type AuthorizationDatabase = Database | AuthorizedTransaction;

/** Read policy and content from one snapshot; explicit transaction contexts reuse their owner's boundary. */
export async function withReadAuthorization<Value>(
  database: AuthorizationDatabase,
  operation: (
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
  ) => Promise<Value>,
): Promise<Value> {
  if ("authorization" in database) {
    return operation(database.database, database.authorization);
  }
  if (is(database, PgTransaction)) {
    throw new Error(
      "Nested authorized reads require an explicit transaction context.",
    );
  }
  return database.transaction(
    async (transaction) => {
      const evaluatedAt = new Date();
      return operation(
        transaction,
        new AuthorizationService(
          new ReadSnapshotAuthorizationStore(
            new DrizzleAuthorizationStore(transaction),
          ),
          () => evaluatedAt,
        ),
      );
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Order protected mutations within a workspace before evaluating current permissions. */
export async function withStableAuthorization<Value>(
  database: AuthorizationDatabase | DatabaseTransaction,
  workspaceId: string,
  operation: (
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
  ) => Promise<Value>,
): Promise<Value> {
  const connection = "authorization" in database ? database.database : database;
  return connection.transaction(async (transaction) => {
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

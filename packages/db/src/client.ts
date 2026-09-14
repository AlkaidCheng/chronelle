import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { databaseUrlSchema } from "./config.js";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export interface DatabaseConnection {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export function connectDatabase(databaseUrl: string): DatabaseConnection {
  const validatedDatabaseUrl = databaseUrlSchema.parse(databaseUrl);
  const sql = postgres(validatedDatabaseUrl);
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    async close() {
      await sql.end();
    },
  };
}

export class DatabaseUnavailableError extends Error {
  constructor(reason: string) {
    super(`PostgreSQL is not available: ${reason}`);
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * A connection for a deployment without PostgreSQL: every use of the
 * database or the SQL client fails with DatabaseUnavailableError naming the
 * reason, so a service that still reaches PostgreSQL fails loudly instead
 * of silently, and closing it does nothing.
 */
export function disconnectedDatabase(reason: string): DatabaseConnection {
  const unavailable = () => {
    throw new DatabaseUnavailableError(reason);
  };
  const handler: ProxyHandler<object> = {
    get: (_target, property) =>
      property === "then" ? undefined : unavailable(),
    apply: unavailable,
  };
  return {
    db: new Proxy(() => undefined, handler) as unknown as Database,
    sql: new Proxy(() => undefined, handler) as unknown as Sql,
    async close() {},
  };
}

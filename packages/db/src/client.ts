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

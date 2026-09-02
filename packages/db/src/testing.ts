import postgres from "postgres";

import { connectDatabase, type DatabaseConnection } from "./client.js";
import { createId } from "./ids.js";

export { applyMigrations } from "./migrations.js";

const defaultTestDatabaseUrl =
  "postgresql://chronelle:chronelle_dev@localhost:5432/postgres";

export interface TestDatabase {
  readonly connection: DatabaseConnection;
  readonly databaseUrl: string;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const configuredUrl =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    defaultTestDatabaseUrl;
  const adminUrl = new URL(configuredUrl);
  adminUrl.pathname = "/postgres";

  const databaseName = `chronelle_test_${createId().replaceAll("-", "")}`;
  const adminSql = postgres(adminUrl.toString(), { max: 1 });
  try {
    await adminSql`CREATE DATABASE ${adminSql(databaseName)}`;
  } catch (error) {
    await adminSql.end();
    throw error;
  }

  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const connection = connectDatabase(databaseUrl.toString());

  return {
    connection,
    databaseUrl: databaseUrl.toString(),
    async close() {
      try {
        await connection.close();
      } finally {
        try {
          await adminSql`DROP DATABASE ${adminSql(databaseName)} WITH (FORCE)`;
        } finally {
          await adminSql.end();
        }
      }
    },
  };
}

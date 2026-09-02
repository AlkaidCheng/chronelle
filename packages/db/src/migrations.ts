import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";
import { z } from "zod";

const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url(),
});

export interface MigrationFile {
  checksum: string;
  filename: string;
  sql: string;
}

export async function discoverMigrations(
  migrationDirectory: string,
): Promise<MigrationFile[]> {
  const directoryEntries = await readdir(migrationDirectory, {
    withFileTypes: true,
  });
  const filenames = directoryEntries
    .filter(
      (directoryEntry) =>
        directoryEntry.isFile() &&
        migrationFilenamePattern.test(directoryEntry.name),
    )
    .map((directoryEntry) => directoryEntry.name)
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(resolve(migrationDirectory, filename), "utf8");

      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        filename,
        sql,
      };
    }),
  );
}

export async function applyMigrations(
  environment: NodeJS.ProcessEnv,
  migrationDirectory: string,
): Promise<number> {
  const { DATABASE_URL: databaseUrl } =
    databaseEnvironmentSchema.parse(environment);
  const migrations = await discoverMigrations(migrationDirectory);
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS chronelle_schema_migrations (
        filename text PRIMARY KEY,
        checksum_sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`SELECT pg_advisory_lock(hashtext('chronelle_schema_migrations'))`;

    try {
      const appliedMigrations = await sql<
        { checksum_sha256: string; filename: string }[]
      >`
        SELECT filename, checksum_sha256
        FROM chronelle_schema_migrations
      `;
      const appliedChecksums = new Map(
        appliedMigrations.map((migration) => [
          migration.filename,
          migration.checksum_sha256,
        ]),
      );
      let appliedCount = 0;

      for (const migration of migrations) {
        const appliedChecksum = appliedChecksums.get(migration.filename);

        if (appliedChecksum !== undefined) {
          if (appliedChecksum !== migration.checksum) {
            throw new Error(
              `Applied migration ${migration.filename} has been modified.`,
            );
          }
          continue;
        }

        await sql.begin(async (transaction) => {
          await transaction.unsafe(migration.sql);
          await transaction`
            INSERT INTO chronelle_schema_migrations (
              filename,
              checksum_sha256
            )
            VALUES (${migration.filename}, ${migration.checksum})
          `;
        });
        appliedCount += 1;
      }

      return appliedCount;
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext('chronelle_schema_migrations'))`;
    }
  } finally {
    await sql.end();
  }
}

import { resolve } from "node:path";

import { applyMigrations } from "./migrations.js";

const defaultMigrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);
const migrationDirectory = process.env.CHRONELLE_MIGRATIONS_DIR
  ? resolve(process.env.CHRONELLE_MIGRATIONS_DIR)
  : defaultMigrationDirectory;

try {
  const appliedCount = await applyMigrations(process.env, migrationDirectory);
  console.log(`Applied ${appliedCount} migration(s).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

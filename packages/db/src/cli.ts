import { resolve } from "node:path";

import { assertRenamedVariable } from "./config.js";
import { applyMigrations } from "./migrations.js";

const defaultMigrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

try {
  assertRenamedVariable(
    process.env,
    "LIVTALES_MIGRATIONS_DIR",
    "CHRONELLE_MIGRATIONS_DIR",
  );
  const migrationDirectory = process.env.LIVTALES_MIGRATIONS_DIR
    ? resolve(process.env.LIVTALES_MIGRATIONS_DIR)
    : defaultMigrationDirectory;
  const appliedCount = await applyMigrations(process.env, migrationDirectory);
  console.log(`Applied ${appliedCount} migration(s).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

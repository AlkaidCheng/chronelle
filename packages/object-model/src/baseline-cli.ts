import { connectDatabase } from "@livtales/db";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { baselineObjectRevisions } from "./revision-baseline.js";

const environmentFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
const database = connectDatabase(process.env.DATABASE_URL ?? "");
try {
  console.log(
    `Captured ${await baselineObjectRevisions(database.db)} object baseline(s).`,
  );
} finally {
  await database.close();
}

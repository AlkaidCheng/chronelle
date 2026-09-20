import { connectDatabase } from "./client.js";
import { readDatabaseFootprint } from "./footprint.js";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--history")) {
    throw new Error("Invalid arguments");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("Missing DATABASE_URL");
  const connection = connectDatabase(databaseUrl);
  try {
    const report = await readDatabaseFootprint(connection.sql, {
      includeHistory: args.includes("--history"),
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await connection.close();
  }
} catch {
  // Driver and validation errors may include credentials or record content.
  console.error(
    "Database footprint inspection failed. Check DATABASE_URL, read privileges, and usage: pnpm db:footprint [--history].",
  );
  process.exitCode = 1;
}

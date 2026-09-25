import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  assertCloudBaseApiKeyFresh,
  connectCloudBaseRdb,
  connectDatabase,
  disconnectedDatabase,
} from "@livtales/db";
import { z } from "zod";

import { buildApp } from "./app.js";
import { backendEnvironmentSchema, resolveBackend } from "./backend-mode.js";
import { createAppDependencies } from "./dependencies.js";
import { RecordingEmailSender } from "./seed/recording-email-sender.js";
import { seedTestData, type SeedReport } from "./seed/test-data.js";

/**
 * Creates the test accounts and their data on the backend the environment
 * names, the way the API would serve them: `CHRONELLE_BACKEND=postgres`
 * with `DATABASE_URL`, or `CHRONELLE_BACKEND=cloudbase` with
 * `CLOUDBASE_ENV_ID` and `CLOUDBASE_APIKEY`. The password comes from
 * `SEED_PASSWORD` or `--password`; `WEB_PUBLIC_URL` is the origin the
 * invitation link points at.
 */
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const environmentSchema = backendEnvironmentSchema.extend({
  CLOUDBASE_ENV_ID: z.string().min(1).optional(),
  CLOUDBASE_APIKEY: z.string().min(1).optional(),
  CLOUDBASE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(30_000),
  WEB_PUBLIC_URL: z.url().default("http://localhost:3000"),
  SEED_PASSWORD: z.string().min(10).max(256).optional(),
});

const { values } = parseArgs({
  options: { password: { type: "string" } },
});
const environment = environmentSchema.parse(process.env);
const password = values.password ?? environment.SEED_PASSWORD;
if (password === undefined || password.length < 10) {
  console.error(
    "Set SEED_PASSWORD (or pass --password) to a password of at least ten characters.",
  );
  process.exit(2);
}

const backend = resolveBackend(environment);
const database =
  backend.databaseUrl === undefined
    ? disconnectedDatabase(
        "CHRONELLE_BACKEND=cloudbase serves from the gateway",
      )
    : connectDatabase(backend.databaseUrl);
const cloudBaseRdb = backend.cloudBaseReads
  ? await connectCloudBaseRdb({
      envId: required(environment.CLOUDBASE_ENV_ID, "CLOUDBASE_ENV_ID"),
      accessKey: freshKey(
        required(environment.CLOUDBASE_APIKEY, "CLOUDBASE_APIKEY"),
      ),
      requestTimeoutMs: environment.CLOUDBASE_REQUEST_TIMEOUT_MS,
      onRequest: () => undefined,
    })
  : undefined;
const email = new RecordingEmailSender();
const app = buildApp(
  createAppDependencies(database, undefined, {
    cloudBaseRdb,
    cloudBaseWrites: backend.cloudBaseWrites,
    email,
    friends: { webBaseUrl: environment.WEB_PUBLIC_URL },
  }),
  { logger: false },
);

function required(value: string | undefined, name: string): string {
  if (value === undefined)
    throw new Error(`${name} is required when CHRONELLE_BACKEND=cloudbase.`);
  return value;
}

function freshKey(key: string): string {
  assertCloudBaseApiKeyFresh(key);
  return key;
}

function print(report: SeedReport): void {
  const width = Math.max(...report.accounts.map((a) => a.username.length));
  console.log(`Backend: ${backend.backend}`);
  console.log(`Sign in at ${environment.WEB_PUBLIC_URL}/sign-in`);
  console.log("");
  for (const account of report.accounts) {
    console.log(
      `  ${account.username.padEnd(width)}  ${account.email.padEnd(26)}  ${account.displayName.padEnd(12)}  ${account.status}`,
    );
  }
  console.log(`  password: ${password}`);
  console.log("");
  const created = Object.entries(report.created);
  if (created.length === 0) {
    console.log(
      "The accounts already existed; their data was left as it is. Start from an empty database to seed again.",
    );
    return;
  }
  console.log(
    `Created ${created.map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`).join(", ")}.`,
  );
  if (report.invitationLink !== null)
    console.log(`Open invitation link (Mei's): ${report.invitationLink}`);
}

let code = 0;
try {
  await app.ready();
  print(await seedTestData(app, email, { password }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  code = 1;
} finally {
  await app.close();
  await database.close();
}
process.stdout.write("", () => process.exit(code));

import { existsSync } from "node:fs";

import { z } from "zod";

import {
  assertCloudBaseApiKeyFresh,
  connectCloudBaseRdb,
  connectDatabase,
} from "@chronelle/db";
import { assertRevisionBaseline } from "@chronelle/object-model";

import { buildApp } from "./app.js";
import { createDevelopmentAppDependencies } from "./dependencies.js";
import { createDocumentStorage } from "./documents/storage-configuration.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const runtimeEnvironmentSchema = z.object({
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  DATABASE_URL: z.url(),
  CLOUDBASE_READS_ENABLED: z.stringbool().default(false),
  CLOUDBASE_ENV_ID: z.string().min(1).optional(),
  CLOUDBASE_APIKEY: z.string().min(1).optional(),
  CLOUDBASE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(30_000),
  DEVELOPMENT_AUTH_SESSION_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(720),
  ENABLE_DEVELOPMENT_AUTH: z.stringbool().default(false),
  DOCUMENT_TRANSFER_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
});

const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env);
if (!runtimeEnvironment.ENABLE_DEVELOPMENT_AUTH) {
  throw new Error("No authentication provider is enabled.");
}
const storage = createDocumentStorage(process.env);
const database = connectDatabase(runtimeEnvironment.DATABASE_URL);
const cloudBaseRdb = runtimeEnvironment.CLOUDBASE_READS_ENABLED
  ? await createCloudBaseReadClient()
  : undefined;
const dependencies = createDevelopmentAppDependencies(database, {
  developmentSessionTtlMs:
    runtimeEnvironment.DEVELOPMENT_AUTH_SESSION_TTL_MINUTES * 60_000,
  documentTransferTtlMs:
    runtimeEnvironment.DOCUMENT_TRANSFER_TTL_SECONDS * 1_000,
  cloudBaseRdb,
  storage,
});
const app = buildApp(dependencies, { logger: true });

app.addHook("onClose", async () => {
  await database.close();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

function missingCloudBaseValue(name: string): never {
  throw new Error(`${name} is required when CLOUDBASE_READS_ENABLED=true.`);
}

async function createCloudBaseReadClient() {
  const envId =
    runtimeEnvironment.CLOUDBASE_ENV_ID ??
    missingCloudBaseValue("CLOUDBASE_ENV_ID");
  const accessKey =
    runtimeEnvironment.CLOUDBASE_APIKEY ??
    missingCloudBaseValue("CLOUDBASE_APIKEY");
  assertCloudBaseApiKeyFresh(accessKey);
  return connectCloudBaseRdb({
    envId,
    accessKey,
    requestTimeoutMs: runtimeEnvironment.CLOUDBASE_REQUEST_TIMEOUT_MS,
  });
}

try {
  await assertRevisionBaseline(database.db);
  await app.listen({
    host: runtimeEnvironment.API_HOST,
    port: runtimeEnvironment.API_PORT,
  });
} catch {
  app.log.error({ code: "startup_failed" }, "The API could not start.");
  await app.close();
  process.exitCode = 1;
}

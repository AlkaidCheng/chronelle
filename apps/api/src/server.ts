import { existsSync } from "node:fs";

import { z } from "zod";

import {
  assertCloudBaseApiKeyFresh,
  connectCloudBaseRdb,
  connectDatabase,
  disconnectedDatabase,
  type CloudBaseRequestEvent,
} from "@chronelle/db";
import {
  assertCloudBaseBackendReady,
  assertRevisionBaseline,
} from "@chronelle/object-model";

import { buildApp } from "./app.js";
import {
  backendEnvironmentSchema,
  cloudBaseRequiredFunctions,
  gatewayEventLevel,
  resolveBackend,
} from "./backend-mode.js";
import { createDevelopmentAppDependencies } from "./dependencies.js";
import { createDocumentStorage } from "./documents/storage-configuration.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const runtimeEnvironmentSchema = backendEnvironmentSchema.extend({
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
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
const backend = resolveBackend(runtimeEnvironment);
const storage = createDocumentStorage(process.env);
// The CloudBase backend never opens a PostgreSQL connection; any service that
// still reached one would fail with the reason instead of a connection error.
const database =
  backend.databaseUrl === undefined
    ? disconnectedDatabase(
        "CHRONELLE_BACKEND=cloudbase serves from the gateway",
      )
    : connectDatabase(backend.databaseUrl);
// Gateway requests are logged once the app's logger exists.
let logGatewayRequest = (_event: CloudBaseRequestEvent): void => undefined;
const cloudBaseRdb = backend.cloudBaseReads
  ? await createCloudBaseClient((event) => logGatewayRequest(event))
  : undefined;
const dependencies = createDevelopmentAppDependencies(database, {
  developmentSessionTtlMs:
    runtimeEnvironment.DEVELOPMENT_AUTH_SESSION_TTL_MINUTES * 60_000,
  documentTransferTtlMs:
    runtimeEnvironment.DOCUMENT_TRANSFER_TTL_SECONDS * 1_000,
  cloudBaseRdb,
  cloudBaseWrites: backend.cloudBaseWrites,
  storage,
});
const app = buildApp(dependencies, { logger: true });
logGatewayRequest = (event) => {
  app.log[gatewayEventLevel(event)](
    { cloudbase: event },
    "CloudBase gateway request",
  );
};

app.addHook("onClose", async () => {
  await database.close();
});

/**
 * Closes the app and ends the process once its output has flushed. The
 * CloudBase SDK keeps a timer alive, so an idle event loop cannot be relied
 * on to end the process after the server has closed.
 */
async function shutdown(code: number): Promise<void> {
  await app.close();
  process.stdout.write("", () => process.exit(code));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(0);
  });
}

function missingCloudBaseValue(name: string): never {
  throw new Error(
    `${name} is required when CLOUDBASE_READS_ENABLED=true or CHRONELLE_BACKEND=cloudbase.`,
  );
}

async function createCloudBaseClient(
  onRequest: (event: CloudBaseRequestEvent) => void,
) {
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
    onRequest,
  });
}

try {
  if (backend.backend === "cloudbase" && cloudBaseRdb !== undefined) {
    await assertCloudBaseBackendReady(cloudBaseRdb, cloudBaseRequiredFunctions);
  } else {
    await assertRevisionBaseline(database.db);
  }
  app.log.info({ backend: backend.backend }, "Chronelle backend selected");
  await app.listen({
    host: runtimeEnvironment.API_HOST,
    port: runtimeEnvironment.API_PORT,
  });
} catch (error) {
  app.log.error(
    {
      code: "startup_failed",
      reason: error instanceof Error ? error.message : String(error),
    },
    "The API could not start.",
  );
  await shutdown(1);
}

import { existsSync } from "node:fs";
import {
  assertCloudBaseApiKeyFresh,
  type CloudBaseRequestEvent,
  connectCloudBaseRdb,
  connectDatabase,
  disconnectedDatabase,
} from "@livtales/db";
import {
  assertCloudBaseBackendReady,
  assertRevisionBaseline,
} from "@livtales/object-model";
import { z } from "zod";

import { buildApp } from "./app.js";
import {
  type EmailMessage,
  type EmailSender,
  LoggingEmailSender,
} from "./authentication/email-sender.js";
import { FileEmailSender } from "./authentication/file-email-sender.js";
import type { ThrottledIssue } from "./authentication/password-auth-service.js";
import { SmtpEmailSender } from "./authentication/smtp-email-sender.js";
import {
  TencentSesEmailSender,
  parseEmailTemplateIds,
} from "./authentication/tencent-ses-email-sender.js";
import { CloudBaseWeChatIdentityVerifier } from "./authentication/wechat-identity-verifier.js";
import {
  backendEnvironmentSchema,
  cloudBaseRequiredFunctions,
  gatewayEventLevel,
  resolveBackend,
} from "./backend-mode.js";
import {
  createAppDependencies,
  createDevelopmentAppDependencies,
} from "./dependencies.js";
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
  AUTH_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(20_160),
  AUTH_VERIFICATION_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .max(1_440)
    .default(15),
  EMAIL_PROVIDER: z.enum(["log", "file", "smtp", "tencent-ses"]).default("log"),
  EMAIL_FILE_PATH: z.string().min(1).optional(),
  SMTP_URL: z.url().optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  TENCENT_SES_SECRET_ID: z.string().min(1).optional(),
  TENCENT_SES_SECRET_KEY: z.string().min(1).optional(),
  TENCENT_SES_REGION: z.string().min(1).default("ap-hongkong"),
  TENCENT_SES_TEMPLATES: z.string().min(2).optional(),
  ENABLE_DEVELOPMENT_AUTH: z.stringbool().default(false),
  ENABLE_WECHAT_AUTH: z.stringbool().default(false),
  CLOUDBASE_WECHAT_PROVIDER_IDS: z
    .string()
    .min(1)
    .default("wechat,weixin,wx,wx_openid"),
  CLOUDBASE_AUTH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(30_000)
    .default(10_000),
  /** The web origin that friend invitation emails link to for sign-up. */
  WEB_PUBLIC_URL: z.url().optional(),
  DOCUMENT_TRANSFER_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
});

const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env);

function composeEmailSender(
  environment: typeof runtimeEnvironment,
  log: (message: EmailMessage) => void,
): EmailSender {
  if (environment.EMAIL_PROVIDER === "log") return new LoggingEmailSender(log);
  if (environment.EMAIL_PROVIDER === "file") {
    if (environment.EMAIL_FILE_PATH === undefined)
      throw new Error("EMAIL_PROVIDER=file requires EMAIL_FILE_PATH.");
    return new FileEmailSender(environment.EMAIL_FILE_PATH);
  }
  if (environment.EMAIL_PROVIDER === "tencent-ses") {
    if (
      environment.TENCENT_SES_SECRET_ID === undefined ||
      environment.TENCENT_SES_SECRET_KEY === undefined ||
      environment.TENCENT_SES_TEMPLATES === undefined ||
      environment.EMAIL_FROM === undefined
    )
      throw new Error(
        "EMAIL_PROVIDER=tencent-ses requires TENCENT_SES_SECRET_ID, TENCENT_SES_SECRET_KEY, TENCENT_SES_TEMPLATES, and EMAIL_FROM.",
      );
    return new TencentSesEmailSender({
      credential: {
        secretId: environment.TENCENT_SES_SECRET_ID,
        secretKey: environment.TENCENT_SES_SECRET_KEY,
      },
      region: environment.TENCENT_SES_REGION,
      from: environment.EMAIL_FROM,
      templates: parseEmailTemplateIds(environment.TENCENT_SES_TEMPLATES),
    });
  }
  if (
    environment.SMTP_URL === undefined ||
    environment.EMAIL_FROM === undefined
  )
    throw new Error("EMAIL_PROVIDER=smtp requires SMTP_URL and EMAIL_FROM.");
  return new SmtpEmailSender(environment.SMTP_URL, environment.EMAIL_FROM);
}
const backend = resolveBackend(runtimeEnvironment);
const storage = createDocumentStorage(process.env);
// The CloudBase backend never opens a PostgreSQL connection; any service that
// still reached one would fail with the reason instead of a connection error.
const database =
  backend.databaseUrl === undefined
    ? disconnectedDatabase("LIVTALES_BACKEND=cloudbase serves from the gateway")
    : connectDatabase(backend.databaseUrl);
// Gateway requests and log-delivered emails are logged once the app's
// logger exists.
let logGatewayRequest = (_event: CloudBaseRequestEvent): void => undefined;
let logEmail = (_message: EmailMessage): void => undefined;
let logThrottled = (_event: ThrottledIssue): void => undefined;
const email = composeEmailSender(runtimeEnvironment, (message) =>
  logEmail(message),
);
const cloudBaseRdb = backend.cloudBaseReads
  ? await createCloudBaseClient((event) => logGatewayRequest(event))
  : undefined;
const weChatIdentityVerifier = runtimeEnvironment.ENABLE_WECHAT_AUTH
  ? new CloudBaseWeChatIdentityVerifier({
      envId:
        runtimeEnvironment.CLOUDBASE_ENV_ID ??
        missingCloudBaseValue("CLOUDBASE_ENV_ID"),
      providerIds: runtimeEnvironment.CLOUDBASE_WECHAT_PROVIDER_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      requestTimeoutMs: runtimeEnvironment.CLOUDBASE_AUTH_TIMEOUT_MS,
    })
  : undefined;
const composeDependencies = runtimeEnvironment.ENABLE_DEVELOPMENT_AUTH
  ? createDevelopmentAppDependencies
  : (
      connection: typeof database,
      options: Parameters<typeof createAppDependencies>[2],
    ) => createAppDependencies(connection, undefined, options);
const dependencies = composeDependencies(database, {
  sessionTtlMs: runtimeEnvironment.AUTH_SESSION_TTL_MINUTES * 60_000,
  documentTransferTtlMs:
    runtimeEnvironment.DOCUMENT_TRANSFER_TTL_SECONDS * 1_000,
  cloudBaseRdb,
  cloudBaseWrites: backend.cloudBaseWrites,
  storage,
  email,
  passwordAuth: {
    verificationTtlMs:
      runtimeEnvironment.AUTH_VERIFICATION_TTL_MINUTES * 60_000,
    onThrottled: (event) => logThrottled(event),
  },
  weChatIdentityVerifier,
  friends: { webBaseUrl: runtimeEnvironment.WEB_PUBLIC_URL },
});
const app = buildApp(dependencies, { logger: true });
logGatewayRequest = (event) => {
  app.log[gatewayEventLevel(event)](
    { cloudbase: event },
    "CloudBase gateway request",
  );
};
logEmail = (message) => {
  app.log.info({ email: message }, "Email written to the log");
};
logThrottled = (event) => {
  app.log.warn({ verification: event }, "Verification code issue throttled");
};
if (runtimeEnvironment.EMAIL_PROVIDER === "log") {
  app.log.warn(
    "EMAIL_PROVIDER=log writes verification codes to the log; configure smtp or tencent-ses for a deployment",
  );
}

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
  throw new Error(`${name} is required by the enabled CloudBase features.`);
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
  app.log.info({ backend: backend.backend }, "LivTales backend selected");
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

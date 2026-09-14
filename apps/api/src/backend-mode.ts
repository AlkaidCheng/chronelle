import type { CloudBaseRequestEvent } from "@chronelle/db";
import { cloudBaseObjectModelFunctions } from "@chronelle/object-model";
import { z } from "zod";

export const backendEnvironmentSchema = z.object({
  CHRONELLE_BACKEND: z.enum(["postgres", "cloudbase"]).default("postgres"),
  DATABASE_URL: z.url().optional(),
  CLOUDBASE_READS_ENABLED: z.stringbool().optional(),
  CLOUDBASE_WRITES_ENABLED: z.stringbool().optional(),
});

export type BackendEnvironment = z.output<typeof backendEnvironmentSchema>;

/** Which store serves the API, resolved from the deployment settings. */
export interface BackendConfiguration {
  readonly backend: "postgres" | "cloudbase";
  /** Present in the PostgreSQL backend; the CloudBase backend never connects. */
  readonly databaseUrl: string | undefined;
  readonly cloudBaseReads: boolean;
  readonly cloudBaseWrites: boolean;
}

/**
 * The PostgreSQL backend requires DATABASE_URL and takes the two CloudBase
 * flags as staged opt-ins (writes require reads). The CloudBase backend
 * serves every read and write from the gateway, so both flags are implied
 * and may not be switched off, and DATABASE_URL is not used.
 */
export function resolveBackend(
  environment: BackendEnvironment,
): BackendConfiguration {
  if (environment.CHRONELLE_BACKEND === "cloudbase") {
    for (const flag of [
      "CLOUDBASE_READS_ENABLED",
      "CLOUDBASE_WRITES_ENABLED",
    ] as const) {
      if (environment[flag] === false)
        throw new Error(`CHRONELLE_BACKEND=cloudbase requires ${flag}=true.`);
    }
    return {
      backend: "cloudbase",
      databaseUrl: undefined,
      cloudBaseReads: true,
      cloudBaseWrites: true,
    };
  }
  if (environment.DATABASE_URL === undefined)
    throw new Error(
      "DATABASE_URL is required when CHRONELLE_BACKEND=postgres.",
    );
  const reads = environment.CLOUDBASE_READS_ENABLED ?? false;
  const writes = environment.CLOUDBASE_WRITES_ENABLED ?? false;
  if (writes && !reads)
    throw new Error(
      "CLOUDBASE_WRITES_ENABLED=true requires CLOUDBASE_READS_ENABLED=true.",
    );
  return {
    backend: "postgres",
    databaseUrl: environment.DATABASE_URL,
    cloudBaseReads: reads,
    cloudBaseWrites: writes,
  };
}

/** Every database function the API's adapters call, verified at startup in the CloudBase backend. */
export const cloudBaseRequiredFunctions: readonly string[] = [
  ...cloudBaseObjectModelFunctions,
  "chronelle_identity_sign_in",
  "chronelle_session_create",
  "chronelle_session_resolve",
  "chronelle_session_revoke",
  "chronelle_sessions_revoke_all",
];

/** The log level for one gateway request: conflicts and denials are routine, failures are not. */
export function gatewayEventLevel(
  event: CloudBaseRequestEvent,
): "debug" | "info" | "error" {
  switch (event.outcome) {
    case "ok":
      return "debug";
    case "rejected":
      return event.status !== undefined && event.status < 500
        ? "info"
        : "error";
    default:
      return "error";
  }
}

import {
  assertRenamedVariable,
  type CloudBaseRequestEvent,
} from "@livtales/db";
import { cloudBaseObjectModelFunctions } from "@livtales/object-model";
import { z } from "zod";

export const backendEnvironmentSchema = z.object({
  LIVTALES_BACKEND: z.enum(["postgres", "cloudbase"]).optional(),
  /** The name LIVTALES_BACKEND had before, kept so resolveBackend can refuse it. */
  CHRONELLE_BACKEND: z.string().optional(),
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
 * LIVTALES_BACKEND selects the backend and defaults to PostgreSQL; a legacy
 * CHRONELLE_BACKEND stops startup unless LIVTALES_BACKEND matches it. The
 * PostgreSQL backend requires DATABASE_URL and takes the two CloudBase
 * flags as staged opt-ins (writes require reads). The CloudBase backend
 * serves every read and write from the gateway, so both flags are implied
 * and may not be switched off, and DATABASE_URL is not used.
 */
export function resolveBackend(
  environment: BackendEnvironment,
): BackendConfiguration {
  assertRenamedVariable(environment, "LIVTALES_BACKEND", "CHRONELLE_BACKEND");
  if (environment.LIVTALES_BACKEND === "cloudbase") {
    for (const flag of [
      "CLOUDBASE_READS_ENABLED",
      "CLOUDBASE_WRITES_ENABLED",
    ] as const) {
      if (environment[flag] === false)
        throw new Error(`LIVTALES_BACKEND=cloudbase requires ${flag}=true.`);
    }
    return {
      backend: "cloudbase",
      databaseUrl: undefined,
      cloudBaseReads: true,
      cloudBaseWrites: true,
    };
  }
  if (environment.DATABASE_URL === undefined)
    throw new Error("DATABASE_URL is required when LIVTALES_BACKEND=postgres.");
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
  "chronelle_identity_session_resolve",
  "chronelle_user_session_resolve",
  "chronelle_wechat_exchange",
  "chronelle_wechat_identity_link",
  "chronelle_user_preferences_update",
  "chronelle_username_available",
  "chronelle_account_update",
  "chronelle_users_search",
  "chronelle_user_lookup",
  "chronelle_account_update",
  "chronelle_users_search",
  "chronelle_user_lookup",
  "chronelle_session_create",
  "chronelle_session_resolve",
  "chronelle_session_revoke",
  "chronelle_sessions_revoke_all",
  "chronelle_password_credential_create",
  "chronelle_password_credential_lookup",
  "chronelle_password_attempt_record",
  "chronelle_email_verified",
  "chronelle_password_hash_update",
  "chronelle_verification_issue",
  "chronelle_verification_consume",
  "chronelle_friend_list",
  "chronelle_friend_invite",
  "chronelle_friend_request",
  "chronelle_friend_request",
  "chronelle_friend_respond",
  "chronelle_friend_withdraw",
  "chronelle_friend_remove",
  "chronelle_friend_resend",
  "chronelle_friend_link",
  "chronelle_friend_invitations_claim",
  "chronelle_friend_invitation_peek",
  "chronelle_friend_invitation_accept",
  "chronelle_pending_share_create",
  "chronelle_pending_share_list",
  "chronelle_pending_share_revoke",
  "chronelle_person_shares_list",
  "chronelle_person_account",
  "chronelle_workspace_create",
  "chronelle_workspace_update",
  "chronelle_workspace_member_list",
  "chronelle_workspace_member_add",
  "chronelle_workspace_member_role",
  "chronelle_workspace_member_remove",
  "chronelle_workspace_leave",
  "chronelle_workspace_deletion",
  "chronelle_workspace_delete",
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

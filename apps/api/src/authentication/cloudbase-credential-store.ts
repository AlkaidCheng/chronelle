import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type EmailVerificationRow,
  type UserCredentialRow,
  type VerificationPurpose,
} from "@chronelle/db";

import {
  type CloudBaseRow,
  instant,
  nullableInstant,
  record,
  text,
  userRow,
} from "../identity/cloudbase-rows.js";
import {
  type AttemptPolicy,
  CredentialConflictError,
  type CredentialStore,
  type IssueOutcome,
  type IssuePolicy,
  type PasswordAccount,
  type VerificationOutcome,
} from "./credential-store.js";

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function credentialRow(row: CloudBaseRow): UserCredentialRow {
  return {
    userId: text(row.user_id, "credential user"),
    passwordHash: text(row.password_hash, "password hash"),
    emailVerifiedAt: nullableInstant(
      row.email_verified_at,
      "email_verified_at",
    ),
    failedAttempts: integer(row.failed_attempts, "failed_attempts"),
    lockedUntil: nullableInstant(row.locked_until, "locked_until"),
    createdAt: instant(row.created_at, "created_at"),
    updatedAt: instant(row.updated_at, "updated_at"),
  };
}

function verificationRow(row: CloudBaseRow): EmailVerificationRow {
  const purpose = text(row.purpose, "verification purpose");
  if (purpose !== "verify_email" && purpose !== "reset_password")
    throw new Error("CloudBase returned an invalid verification purpose.");
  return {
    id: text(row.id, "verification id"),
    userId: text(row.user_id, "verification user"),
    purpose,
    codeHash: text(row.code_hash, "code hash"),
    attempts: integer(row.attempts, "attempts"),
    createdAt: instant(row.created_at, "created_at"),
    expiresAt: instant(row.expires_at, "expires_at"),
    consumedAt: nullableInstant(row.consumed_at, "consumed_at"),
  };
}

const outcomes: readonly VerificationOutcome[] = [
  "consumed",
  "mismatch",
  "exhausted",
  "expired",
  "none",
];

/**
 * Credential persistence through the gateway: the chronelle_password_*,
 * chronelle_email_verified, and chronelle_verification_* functions, with the
 * PostgreSQL store's semantics.
 */
export class CloudBaseCredentialStore implements CredentialStore {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async createCredential(
    userId: string,
    passwordHash: string,
  ): Promise<UserCredentialRow> {
    let created: unknown;
    try {
      created = await this.#client.rpc("chronelle_password_credential_create", {
        user_id: userId,
        password_hash: passwordHash,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError && error.status === 409)
        throw new CredentialConflictError();
      throw failure(error);
    }
    return credentialRow(record(created, "credential"));
  }

  async findAccount(email: string): Promise<PasswordAccount | null> {
    const found = await this.#call("chronelle_password_credential_lookup", {
      email,
    });
    if (found === null || found === undefined) return null;
    const row = record(found, "account");
    return {
      user: userRow(record(row.user, "user")),
      credential: credentialRow(record(row.credential, "credential")),
    };
  }

  async recordAttempt(
    userId: string,
    succeeded: boolean,
    observedAt: Date,
    policy: AttemptPolicy,
  ): Promise<UserCredentialRow> {
    const updated = await this.#call("chronelle_password_attempt_record", {
      user_id: userId,
      succeeded,
      observed_at: observedAt.toISOString(),
      max_attempts: policy.maxAttempts,
      lock_seconds: Math.ceil(policy.lockMs / 1_000),
    });
    return credentialRow(record(updated, "credential"));
  }

  async markEmailVerified(
    userId: string,
    verifiedAt: Date,
    requestId: string,
  ): Promise<UserCredentialRow> {
    const updated = await this.#call("chronelle_email_verified", {
      user_id: userId,
      verified_at: verifiedAt.toISOString(),
      request_id: requestId,
    });
    return credentialRow(record(updated, "credential"));
  }

  async replacePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: Date,
    requestId: string,
  ): Promise<UserCredentialRow> {
    const updated = await this.#call("chronelle_password_hash_update", {
      user_id: userId,
      password_hash: passwordHash,
      updated_at: updatedAt.toISOString(),
      request_id: requestId,
    });
    return credentialRow(record(updated, "credential"));
  }

  async issueVerification(
    userId: string,
    purpose: VerificationPurpose,
    codeHash: string,
    expiresAt: Date,
    policy: IssuePolicy,
  ): Promise<IssueOutcome> {
    const result = await this.#call("chronelle_verification_issue", {
      user_id: userId,
      purpose,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
      min_interval_seconds: Math.ceil(policy.minIntervalMs / 1_000),
      window_seconds: Math.ceil(policy.windowMs / 1_000),
      max_per_window: policy.maxPerWindow,
    });
    const outcome = record(result, "issue result");
    if (outcome.throttled === true) {
      const retryAfterSeconds = integer(
        outcome.retryAfterSeconds,
        "retryAfterSeconds",
      );
      return { throttled: true, retryAfterMs: retryAfterSeconds * 1_000 };
    }
    return {
      throttled: false,
      verification: verificationRow(
        record(outcome.verification, "verification"),
      ),
    };
  }

  async consumeVerification(
    userId: string,
    purpose: VerificationPurpose,
    codeHash: string,
    observedAt: Date,
    maxAttempts: number,
  ): Promise<VerificationOutcome> {
    const result = await this.#call("chronelle_verification_consume", {
      user_id: userId,
      purpose,
      code_hash: codeHash,
      observed_at: observedAt.toISOString(),
      max_attempts: maxAttempts,
    });
    const status = record(result, "verification result").status;
    const outcome = outcomes.find((candidate) => candidate === status);
    if (outcome === undefined)
      throw new Error("CloudBase returned an invalid verification outcome.");
    return outcome;
  }

  async #call(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, parameters);
    } catch (error) {
      throw failure(error);
    }
  }
}

function failure(error: unknown): unknown {
  return error instanceof CloudBaseRpcError
    ? new Error(`Credential persistence failed: ${error.message}`)
    : error;
}

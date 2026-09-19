import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  type EmailVerificationRow,
  type UserCredentialRow,
  type UserRow,
  type VerificationPurpose,
  emailVerifications,
  userCredentials,
  users,
  workspaces,
} from "@chronelle/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { passwordIdentityProvider } from "./auth-provider.js";

/** The provider name password accounts are recorded under; the subject is the normalized email. */
export { passwordIdentityProvider };

/** A password account: the user and its credential. */
export interface PasswordAccount {
  readonly user: UserRow;
  readonly credential: UserCredentialRow;
}

/** The outcome of presenting a verification code. */
export type VerificationOutcome =
  "consumed" | "mismatch" | "exhausted" | "expired" | "none";

export interface AttemptPolicy {
  /** Failures before the credential locks. */
  readonly maxAttempts: number;
  /** How long the lock lasts. */
  readonly lockMs: number;
}

/** How often codes may be issued for one user and purpose. */
export interface IssuePolicy {
  /** The least time between two codes. */
  readonly minIntervalMs: number;
  /** The window over which issues are counted. */
  readonly windowMs: number;
  /** Codes allowed in the window, consumed or not. */
  readonly maxPerWindow: number;
}

/** A code was issued, or the policy refused one until retryAfterMs have passed. */
export type IssueOutcome =
  | { readonly throttled: false; readonly verification: EmailVerificationRow }
  | { readonly throttled: true; readonly retryAfterMs: number };

/**
 * Credential persistence for password accounts: the credential of a user
 * (created once; a second creation is a conflict), the account for a
 * normalized email, the failed-attempt lock, email verification and password
 * replacement with their audit events, and emailed verification codes (one
 * open code per purpose; consuming counts mismatches and stops at the
 * attempt limit).
 */
export interface CredentialStore {
  createCredential(
    userId: string,
    passwordHash: string,
  ): Promise<UserCredentialRow>;
  /** The account behind a login: an email when it holds an "@", else a username without regard to case. */
  findAccount(login: string): Promise<PasswordAccount | null>;
  recordAttempt(
    userId: string,
    succeeded: boolean,
    observedAt: Date,
    policy: AttemptPolicy,
  ): Promise<UserCredentialRow>;
  markEmailVerified(
    userId: string,
    verifiedAt: Date,
    requestId: string,
  ): Promise<UserCredentialRow>;
  replacePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: Date,
    requestId: string,
  ): Promise<UserCredentialRow>;
  issueVerification(
    userId: string,
    purpose: VerificationPurpose,
    codeHash: string,
    expiresAt: Date,
    policy: IssuePolicy,
  ): Promise<IssueOutcome>;
  consumeVerification(
    userId: string,
    purpose: VerificationPurpose,
    codeHash: string,
    observedAt: Date,
    maxAttempts: number,
  ): Promise<VerificationOutcome>;
}

export class CredentialConflictError extends Error {
  constructor() {
    super("The user already has a password credential.");
    this.name = "CredentialConflictError";
  }
}

const instant = (value: Date) => sql`${value.toISOString()}::timestamptz`;

export class PostgresCredentialStore implements CredentialStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async createCredential(
    userId: string,
    passwordHash: string,
  ): Promise<UserCredentialRow> {
    return this.#database.transaction(async (transaction) => {
      const [owner] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (owner === undefined) throw new Error("The user does not exist.");
      const [created] = await transaction
        .insert(userCredentials)
        .values({ userId, passwordHash })
        .onConflictDoNothing({ target: userCredentials.userId })
        .returning();
      if (created === undefined) throw new CredentialConflictError();
      return created;
    });
  }

  async findAccount(login: string): Promise<PasswordAccount | null> {
    const [found] = await this.#database
      .select({ user: users, credential: userCredentials })
      .from(users)
      .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
      .where(
        and(
          eq(users.identityProvider, passwordIdentityProvider),
          login.includes("@")
            ? eq(users.providerSubject, login)
            : eq(sql`lower(${users.username})`, login.toLowerCase()),
        ),
      )
      .limit(1);
    return found ?? null;
  }

  async recordAttempt(
    userId: string,
    succeeded: boolean,
    observedAt: Date,
    policy: AttemptPolicy,
  ): Promise<UserCredentialRow> {
    const updatedAt = sql`GREATEST(${instant(observedAt)}, ${userCredentials.createdAt})`;
    const [updated] = succeeded
      ? await this.#database
          .update(userCredentials)
          .set({ failedAttempts: 0, lockedUntil: null, updatedAt })
          .where(eq(userCredentials.userId, userId))
          .returning()
      : await this.#database
          .update(userCredentials)
          .set({
            failedAttempts: sql`CASE WHEN ${userCredentials.failedAttempts} + 1 >= ${policy.maxAttempts} THEN 0 ELSE ${userCredentials.failedAttempts} + 1 END`,
            lockedUntil: sql`CASE WHEN ${userCredentials.failedAttempts} + 1 >= ${policy.maxAttempts} THEN ${instant(new Date(observedAt.getTime() + policy.lockMs))} ELSE ${userCredentials.lockedUntil} END`,
            updatedAt,
          })
          .where(eq(userCredentials.userId, userId))
          .returning();
    if (updated === undefined)
      throw new Error("The credential does not exist.");
    return updated;
  }

  async markEmailVerified(
    userId: string,
    verifiedAt: Date,
    requestId: string,
  ): Promise<UserCredentialRow> {
    return this.#database.transaction(async (transaction) => {
      const verified = sql`GREATEST(${instant(verifiedAt)}, ${userCredentials.createdAt})`;
      const [updated] = await transaction
        .update(userCredentials)
        .set({
          emailVerifiedAt: sql`COALESCE(${userCredentials.emailVerifiedAt}, ${verified})`,
          updatedAt: verified,
        })
        .where(eq(userCredentials.userId, userId))
        .returning();
      if (updated === undefined)
        throw new Error("The credential does not exist.");
      await recordCredentialEvent(
        transaction,
        userId,
        "credential.email_verified",
        requestId,
      );
      return updated;
    });
  }

  async replacePasswordHash(
    userId: string,
    passwordHash: string,
    updatedAt: Date,
    requestId: string,
  ): Promise<UserCredentialRow> {
    return this.#database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(userCredentials)
        .set({
          passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: sql`GREATEST(${instant(updatedAt)}, ${userCredentials.createdAt})`,
        })
        .where(eq(userCredentials.userId, userId))
        .returning();
      if (updated === undefined)
        throw new Error("The credential does not exist.");
      await recordCredentialEvent(
        transaction,
        userId,
        "credential.password_reset",
        requestId,
      );
      return updated;
    });
  }

  async issueVerification(
    userId: string,
    purpose: VerificationPurpose,
    codeHash: string,
    expiresAt: Date,
    policy: IssuePolicy,
  ): Promise<IssueOutcome> {
    return this.#database.transaction(async (transaction) => {
      const [owner] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (owner === undefined) throw new Error("The user does not exist.");
      const issuedAt = new Date();
      const throttled = await refusalUntil(
        transaction,
        userId,
        purpose,
        issuedAt,
        policy,
      );
      if (throttled !== null)
        return { throttled: true, retryAfterMs: throttled };
      await transaction
        .update(emailVerifications)
        .set({
          consumedAt: sql`GREATEST(${instant(issuedAt)}, ${emailVerifications.createdAt})`,
        })
        .where(
          and(
            eq(emailVerifications.userId, userId),
            eq(emailVerifications.purpose, purpose),
            isNull(emailVerifications.consumedAt),
          ),
        );
      const [issued] = await transaction
        .insert(emailVerifications)
        .values({
          id: createId(),
          userId,
          purpose,
          codeHash,
          createdAt: issuedAt,
          expiresAt,
        })
        .returning();
      if (issued === undefined)
        throw new Error("Verification persistence did not return a code.");
      return { throttled: false, verification: issued };
    });
  }

  async consumeVerification(
    userId: string,
    purpose: VerificationPurpose,
    codeHash: string,
    observedAt: Date,
    maxAttempts: number,
  ): Promise<VerificationOutcome> {
    return this.#database.transaction(async (transaction) => {
      const [open] = await transaction
        .select()
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.userId, userId),
            eq(emailVerifications.purpose, purpose),
            isNull(emailVerifications.consumedAt),
          ),
        )
        .orderBy(desc(emailVerifications.createdAt))
        .limit(1)
        .for("update");
      if (open === undefined) return "none";
      if (open.expiresAt.getTime() <= observedAt.getTime()) return "expired";
      if (open.attempts >= maxAttempts) return "exhausted";
      if (open.codeHash !== codeHash) {
        await transaction
          .update(emailVerifications)
          .set({ attempts: open.attempts + 1 })
          .where(eq(emailVerifications.id, open.id));
        return "mismatch";
      }
      await transaction
        .update(emailVerifications)
        .set({
          consumedAt: sql`GREATEST(${instant(observedAt)}, ${emailVerifications.createdAt})`,
        })
        .where(eq(emailVerifications.id, open.id));
      return "consumed";
    });
  }
}

/**
 * How long until the policy allows another code for the user and purpose,
 * or null when one may be issued now: the latest code must be older than
 * the minimum interval, and fewer than the window's maximum may have been
 * issued within the window.
 */
async function refusalUntil(
  transaction: DatabaseTransaction,
  userId: string,
  purpose: VerificationPurpose,
  issuedAt: Date,
  policy: IssuePolicy,
): Promise<number | null> {
  const owned = and(
    eq(emailVerifications.userId, userId),
    eq(emailVerifications.purpose, purpose),
  );
  if (policy.minIntervalMs > 0) {
    const [latest] = await transaction
      .select({ createdAt: emailVerifications.createdAt })
      .from(emailVerifications)
      .where(owned)
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);
    if (latest !== undefined) {
      const allowedAt = latest.createdAt.getTime() + policy.minIntervalMs;
      if (allowedAt > issuedAt.getTime())
        return Math.max(allowedAt - issuedAt.getTime(), 1);
    }
  }
  if (policy.windowMs > 0 && policy.maxPerWindow > 0) {
    const windowStart = new Date(issuedAt.getTime() - policy.windowMs);
    const recent = await transaction
      .select({ createdAt: emailVerifications.createdAt })
      .from(emailVerifications)
      .where(and(owned, gt(emailVerifications.createdAt, windowStart)))
      .orderBy(emailVerifications.createdAt);
    const oldest = recent[0];
    if (recent.length >= policy.maxPerWindow && oldest !== undefined)
      return Math.max(
        oldest.createdAt.getTime() + policy.windowMs - issuedAt.getTime(),
        1,
      );
  }
  return null;
}

/** A credential event in the user's personal workspace; nothing when the user has none. */
async function recordCredentialEvent(
  transaction: DatabaseTransaction,
  userId: string,
  action: string,
  requestId: string,
): Promise<void> {
  const [personal] = await transaction
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.personalOwnerId, userId))
    .limit(1);
  if (personal === undefined) return;
  await transaction.insert(auditEvents).values({
    id: createId(),
    workspaceId: personal.id,
    actorType: "user",
    actorId: userId,
    action,
    resourceId: null,
    requestId,
    metadata: {},
  });
}

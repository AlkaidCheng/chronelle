import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  emailVerifications,
  userIdentities,
  users,
  workspaces,
} from "@chronelle/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCredentialStore } from "../src/authentication/cloudbase-credential-store.js";
import {
  CredentialConflictError,
  type CredentialStore,
  PostgresCredentialStore,
  passwordIdentityProvider,
} from "../src/authentication/credential-store.js";
import { hashVerificationCode } from "../src/authentication/verification-code.js";

// The chronelle_password_*, chronelle_email_verified, and
// chronelle_verification_* functions must leave and return what the
// PostgreSQL credential store leaves and returns: the credential row and its
// conflict, the account lookup by normalized email, the failed-attempt lock,
// verification and password replacement with their audit events, and the
// one-open-code rule with counted mismatches.

let database: TestDatabase;
let reference: CredentialStore;
let cloudbase: CredentialStore;

const policy = { maxAttempts: 3, lockMs: 60_000 };
const unlimited = { minIntervalMs: 0, windowMs: 0, maxPerWindow: 0 };

/** Issues a code the policy allows and returns its row. */
async function issue(
  store: CredentialStore,
  userId: string,
  purpose: "verify_email" | "reset_password",
  codeHash: string,
  expiresAt: Date,
) {
  const outcome = await store.issueVerification(
    userId,
    purpose,
    codeHash,
    expiresAt,
    unlimited,
  );
  if (outcome.throttled) throw new Error("the code was throttled");
  return outcome.verification;
}
const at = new Date("2030-08-01T12:00:00.000Z");
const later = (ms: number) => new Date(at.getTime() + ms);

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  reference = new PostgresCredentialStore(database.connection.db);
  cloudbase = new CloudBaseCredentialStore({
    rpc: createCloudBaseRpcDouble(database.connection.sql),
  });
});

afterAll(async () => {
  await database?.close();
});

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** A password-provider user with a personal workspace. */
async function person(label: string, provider = passwordIdentityProvider) {
  const email = `${label}-${createId()}@example.test`;
  const db = database.connection.db;
  const [user] = await db
    .insert(users)
    .values({
      id: createId(),
      identityProvider: provider,
      providerSubject: email,
      email,
      displayName: `Person ${label}`,
    })
    .returning();
  if (user === undefined) throw new Error("user insert returned nothing");
  await db.insert(userIdentities).values({
    id: createId(),
    userId: user.id,
    provider,
    subject: email,
  });
  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: createId(),
      displayName: `${user.displayName}'s workspace`,
      createdBy: user.id,
      personalOwnerId: user.id,
    })
    .returning();
  if (workspace === undefined)
    throw new Error("workspace insert returned nothing");
  return { user, workspace, email };
}

// Each store call is its own transaction, so the transaction time orders
// the audits; ids generated within one millisecond do not.
async function auditsOf(workspaceId: string) {
  const rows = await database.connection.db
    .select({ action: auditEvents.action, actorId: auditEvents.actorId })
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(auditEvents.createdAt, auditEvents.id);
  return rows.map((row) => row.action);
}

describe.sequential("credential store", () => {
  it("creates one credential per user and finds the account by email", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user, email } = await person(label);
      const created = await store.createCredential(user.id, "scrypt$hash");
      const duplicate = await store
        .createCredential(user.id, "scrypt$other")
        .then(
          () => "created",
          (error: unknown) => error,
        );
      const unknownUser = await store
        .createCredential(createId(), "scrypt$hash")
        .then(
          () => "created",
          (error: unknown) =>
            (error as Error).message.includes("The user does not exist."),
        );
      const found = await store.findAccount(email);
      const missing = await store.findAccount(
        `nobody-${createId()}@example.test`,
      );
      const otherProvider = await person(label, "development");
      const wrongProvider = await store.findAccount(otherProvider.email);
      results.push({
        created: {
          owns: created.userId === user.id,
          hash: created.passwordHash,
          verified: created.emailVerifiedAt,
          failedAttempts: created.failedAttempts,
          lockedUntil: created.lockedUntil,
        },
        duplicate: duplicate instanceof CredentialConflictError,
        unknownUser,
        found: {
          user: found?.user.id === user.id,
          hash: found?.credential.passwordHash,
        },
        missing,
        wrongProvider,
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      created: {
        owns: true,
        hash: "scrypt$hash",
        verified: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
      duplicate: true,
      unknownUser: true,
      found: { user: true, hash: "scrypt$hash" },
      missing: null,
      wrongProvider: null,
    });
  });

  it("counts failed attempts, locks at the limit, and clears on success", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user } = await person(label);
      await store.createCredential(user.id, "scrypt$hash");
      const first = await store.recordAttempt(user.id, false, at, policy);
      const second = await store.recordAttempt(
        user.id,
        false,
        later(1_000),
        policy,
      );
      const locked = await store.recordAttempt(
        user.id,
        false,
        later(2_000),
        policy,
      );
      const cleared = await store.recordAttempt(
        user.id,
        true,
        later(3_000),
        policy,
      );
      results.push({
        first: [first.failedAttempts, first.lockedUntil],
        second: [second.failedAttempts, second.lockedUntil],
        locked: [locked.failedAttempts, locked.lockedUntil?.toISOString()],
        cleared: [cleared.failedAttempts, cleared.lockedUntil],
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      first: [1, null],
      second: [2, null],
      locked: [0, later(2_000 + policy.lockMs).toISOString()],
      cleared: [0, null],
    });
  });

  it("verifies the email once and replaces the password, each with its audit event", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user, workspace } = await person(label);
      await store.createCredential(user.id, "scrypt$hash");
      await store.recordAttempt(user.id, false, at, {
        ...policy,
        maxAttempts: 1,
      });
      const verified = await store.markEmailVerified(user.id, at, createId());
      const again = await store.markEmailVerified(
        user.id,
        later(5_000),
        createId(),
      );
      const replaced = await store.replacePasswordHash(
        user.id,
        "scrypt$new",
        later(6_000),
        createId(),
      );
      results.push({
        verifiedAt: verified.emailVerifiedAt?.toISOString(),
        keptFirstVerification:
          again.emailVerifiedAt?.getTime() ===
          verified.emailVerifiedAt?.getTime(),
        replaced: {
          hash: replaced.passwordHash,
          failedAttempts: replaced.failedAttempts,
          lockedUntil: replaced.lockedUntil,
          verifiedKept: replaced.emailVerifiedAt !== null,
        },
        audits: await auditsOf(workspace.id),
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      verifiedAt: at.toISOString(),
      keptFirstVerification: true,
      replaced: {
        hash: "scrypt$new",
        failedAttempts: 0,
        lockedUntil: null,
        verifiedKept: true,
      },
      audits: [
        "credential.email_verified",
        "credential.email_verified",
        "credential.password_reset",
      ],
    });
  });

  it("keeps one open code per purpose and consumes it with counted mismatches", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user } = await person(label);
      const code = (n: number) =>
        hashVerificationCode(user.id, "verify_email", `00000${n}`);
      const stale = await issue(
        store,
        user.id,
        "verify_email",
        code(1),
        later(600_000),
      );
      const current = await issue(
        store,
        user.id,
        "verify_email",
        code(2),
        later(600_000),
      );
      const reset = await issue(
        store,
        user.id,
        "reset_password",
        hashVerificationCode(user.id, "reset_password", "000002"),
        later(600_000),
      );
      const open = await database.connection.db
        .select({ id: emailVerifications.id })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.userId, user.id),
            eq(emailVerifications.purpose, "verify_email"),
          ),
        );
      const staleRow = await database.connection.db
        .select({ consumedAt: emailVerifications.consumedAt })
        .from(emailVerifications)
        .where(eq(emailVerifications.id, stale.id));
      const outcomes = {
        wrongPurposeUntouched: reset.consumedAt,
        staleCode: await store.consumeVerification(
          user.id,
          "verify_email",
          code(1),
          at,
          2,
        ),
        mismatch: await store.consumeVerification(
          user.id,
          "verify_email",
          code(9),
          at,
          2,
        ),
        exhausted: await store.consumeVerification(
          user.id,
          "verify_email",
          code(2),
          at,
          2,
        ),
      };
      const fresh = await issue(
        store,
        user.id,
        "verify_email",
        code(3),
        later(600_000),
      );
      const consumed = await store.consumeVerification(
        user.id,
        "verify_email",
        code(3),
        at,
        2,
      );
      const afterwards = await store.consumeVerification(
        user.id,
        "verify_email",
        code(3),
        at,
        2,
      );
      await issue(store, user.id, "verify_email", code(4), later(1_000));
      const expired = await store.consumeVerification(
        user.id,
        "verify_email",
        code(4),
        later(1_000),
        2,
      );
      results.push({
        openCount: open.length,
        staleInvalidated: staleRow[0]?.consumedAt !== null,
        currentOpen: current.consumedAt,
        freshOpen: fresh.consumedAt,
        ...outcomes,
        consumed,
        afterwards,
        expired,
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      openCount: 2,
      staleInvalidated: true,
      currentOpen: null,
      freshOpen: null,
      wrongPurposeUntouched: null,
      staleCode: "mismatch",
      mismatch: "mismatch",
      exhausted: "exhausted",
      consumed: "consumed",
      afterwards: "none",
      expired: "expired",
    });
  });

  it("refuses a code inside the minimum interval and beyond the window's maximum", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user } = await person(label);
      const code = (n: number) =>
        hashVerificationCode(user.id, "verify_email", `10000${n}`);
      const spaced = { minIntervalMs: 60_000, windowMs: 0, maxPerWindow: 0 };
      const first = await store.issueVerification(
        user.id,
        "verify_email",
        code(1),
        later(600_000),
        spaced,
      );
      const tooSoon = await store.issueVerification(
        user.id,
        "verify_email",
        code(2),
        later(600_000),
        spaced,
      );
      // The same code for another purpose is a separate budget.
      const otherPurpose = await store.issueVerification(
        user.id,
        "reset_password",
        hashVerificationCode(user.id, "reset_password", "100003"),
        later(600_000),
        spaced,
      );
      const windowed = {
        minIntervalMs: 0,
        windowMs: 60 * 60_000,
        maxPerWindow: 2,
      };
      const second = await store.issueVerification(
        user.id,
        "verify_email",
        code(4),
        later(600_000),
        windowed,
      );
      const overBudget = await store.issueVerification(
        user.id,
        "verify_email",
        code(5),
        later(600_000),
        windowed,
      );
      const open = await database.connection.db
        .select({ id: emailVerifications.id })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.userId, user.id),
            eq(emailVerifications.purpose, "verify_email"),
            isNull(emailVerifications.consumedAt),
          ),
        );
      results.push({
        first: first.throttled,
        tooSoon:
          tooSoon.throttled &&
          tooSoon.retryAfterMs > 0 &&
          tooSoon.retryAfterMs <= 60_000,
        otherPurpose: otherPurpose.throttled,
        second: second.throttled,
        overBudget:
          overBudget.throttled &&
          overBudget.retryAfterMs > 0 &&
          overBudget.retryAfterMs <= 60 * 60_000,
        openCodes: open.length,
        latestOpenIsSecond:
          !second.throttled && open[0]?.id === second.verification.id,
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      first: false,
      tooSoon: true,
      otherPurpose: false,
      second: false,
      overBudget: true,
      openCodes: 1,
      latestOpenIsSecond: true,
    });
  });
});

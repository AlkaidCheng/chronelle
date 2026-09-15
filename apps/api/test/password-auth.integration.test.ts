import { resolve } from "node:path";

import { auditEvents } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  acceptedResponseSchema,
  apiErrorResponseSchema,
  signInResponseSchema,
} from "@chronelle/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type {
  EmailMessage,
  EmailSender,
} from "../src/authentication/email-sender.js";
import { createAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

/** Keeps every message so a test can read the code that was sent. */
class RecordingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }

  /** The six-digit code in the latest message to an address. */
  codeFor(email: string): string {
    const message = [...this.messages]
      .reverse()
      .find((candidate) => candidate.to === email);
    const code = /\b(\d{6})\b/.exec(message?.text ?? "")?.[1];
    if (code === undefined) throw new Error(`no code was sent to ${email}`);
    return code;
  }
}

let testDatabase: TestDatabase;
let app: FastifyInstance;
let email: RecordingEmailSender;
let ready = false;

const attemptPolicy = { maxAttempts: 3, lockMs: 60_000 };
// The flows below re-send codes within the same second; the issue policy is
// exercised by its own test.
const unlimitedIssues = { minIntervalMs: 0, windowMs: 0, maxPerWindow: 0 };

beforeEach(async () => {
  ready = false;
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  email = new RecordingEmailSender();
  app = buildApp(
    createAppDependencies(testDatabase.connection, undefined, {
      email,
      passwordAuth: {
        attemptPolicy,
        verificationMaxAttempts: 2,
        issuePolicy: unlimitedIssues,
      },
    }),
  );
  ready = true;
});

afterEach(async () => {
  if (ready) {
    await app.close();
    await testDatabase.close();
  }
  ready = false;
});

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, payload });

const sessionOf = async (token: string) =>
  app.inject({
    method: "GET",
    url: "/api/auth/session",
    headers: { authorization: `Bearer ${token}` },
  });

const account = {
  email: "Person@Example.test",
  password: "correct horse battery",
  displayName: "Person",
};
const normalizedEmail = "person@example.test";

async function signUpAndVerify() {
  expect((await post("/api/auth/sign-up", account)).statusCode).toBe(202);
  const verified = await post("/api/auth/verify-email", {
    email: account.email,
    code: email.codeFor(normalizedEmail),
  });
  expect(verified.statusCode).toBe(200);
  return signInResponseSchema.parse(verified.json());
}

describe.sequential("password authentication API", () => {
  it("signs up, refuses sign-in until the emailed code verifies the address, then signs in", async () => {
    const signedUp = await post("/api/auth/sign-up", account);
    expect(signedUp.statusCode).toBe(202);
    expect(acceptedResponseSchema.parse(signedUp.json())).toEqual({
      accepted: true,
    });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]?.to).toBe(normalizedEmail);

    const early = await post("/api/auth/sign-in", {
      email: account.email,
      password: account.password,
    });
    expect(early.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(early.json()).error.code).toBe(
      "email_unverified",
    );
    // The refused sign-in re-sent a code; the latest one is the live one.
    expect(email.messages).toHaveLength(2);

    const wrong = await post("/api/auth/verify-email", {
      email: account.email,
      code: "000000",
    });
    expect(wrong.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(wrong.json()).error.code).toBe(
      "verification_invalid",
    );

    const verified = await post("/api/auth/verify-email", {
      email: account.email,
      code: email.codeFor(normalizedEmail),
    });
    expect(verified.statusCode).toBe(200);
    const session = signInResponseSchema.parse(verified.json());
    expect(session.user.email).toBe(normalizedEmail);
    expect((await sessionOf(session.accessToken)).statusCode).toBe(200);

    const signedIn = await post("/api/auth/sign-in", {
      email: account.email,
      password: account.password,
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signInResponseSchema.parse(signedIn.json()).user.id).toBe(
      session.user.id,
    );
    const audits = await testDatabase.connection.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, session.workspace.id));
    expect(audits.map((audit) => audit.action)).toContain(
      "credential.email_verified",
    );
  });

  it("rejects a second sign-up for the same email and a wrong password", async () => {
    await signUpAndVerify();

    const again = await post("/api/auth/sign-up", account);
    expect(again.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(again.json()).error.code).toBe(
      "email_taken",
    );

    const wrong = await post("/api/auth/sign-in", {
      email: account.email,
      password: "not the password",
    });
    expect(wrong.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(wrong.json()).error.code).toBe(
      "invalid_credentials",
    );
    const unknown = await post("/api/auth/sign-in", {
      email: "nobody@example.test",
      password: "not the password",
    });
    expect(unknown.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(unknown.json()).error.code).toBe(
      "invalid_credentials",
    );
  });

  it("locks the credential after repeated failures", async () => {
    await signUpAndVerify();
    for (
      let attempt = 0;
      attempt < attemptPolicy.maxAttempts - 1;
      attempt += 1
    ) {
      const failed = await post("/api/auth/sign-in", {
        email: account.email,
        password: "wrong",
      });
      expect(failed.statusCode).toBe(401);
    }
    const locking = await post("/api/auth/sign-in", {
      email: account.email,
      password: "wrong",
    });
    expect(locking.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(locking.json()).error.code).toBe(
      "credential_locked",
    );
    const evenCorrect = await post("/api/auth/sign-in", {
      email: account.email,
      password: account.password,
    });
    expect(evenCorrect.statusCode).toBe(429);
  });

  it("stops accepting a code after the attempt limit", async () => {
    expect((await post("/api/auth/sign-up", account)).statusCode).toBe(202);
    const code = email.codeFor(normalizedEmail);
    for (const guess of ["000001", "000002"]) {
      const wrong = await post("/api/auth/verify-email", {
        email: account.email,
        code: guess,
      });
      expect(wrong.statusCode).toBe(400);
    }
    const exhausted = await post("/api/auth/verify-email", {
      email: account.email,
      code,
    });
    expect(exhausted.statusCode).toBe(400);

    const resent = await post("/api/auth/verify-email/resend", {
      email: account.email,
    });
    expect(resent.statusCode).toBe(202);
    const fresh = await post("/api/auth/verify-email", {
      email: account.email,
      code: email.codeFor(normalizedEmail),
    });
    expect(fresh.statusCode).toBe(200);
  });

  it("resets the password with an emailed code and ends every session", async () => {
    const first = await signUpAndVerify();
    const second = signInResponseSchema.parse(
      (
        await post("/api/auth/sign-in", {
          email: account.email,
          password: account.password,
        })
      ).json(),
    );

    const unknown = await post("/api/auth/password-reset", {
      email: "nobody@example.test",
    });
    expect(unknown.statusCode).toBe(202);
    const sentBefore = email.messages.length;
    const requested = await post("/api/auth/password-reset", {
      email: account.email,
    });
    expect(requested.statusCode).toBe(202);
    expect(email.messages).toHaveLength(sentBefore + 1);

    const confirmed = await post("/api/auth/password-reset/confirm", {
      email: account.email,
      code: email.codeFor(normalizedEmail),
      password: "a brand new passphrase",
    });
    expect(confirmed.statusCode).toBe(200);
    const fresh = signInResponseSchema.parse(confirmed.json());

    for (const token of [first.accessToken, second.accessToken]) {
      expect((await sessionOf(token)).statusCode).toBe(401);
    }
    expect((await sessionOf(fresh.accessToken)).statusCode).toBe(200);
    expect(
      (
        await post("/api/auth/sign-in", {
          email: account.email,
          password: account.password,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await post("/api/auth/sign-in", {
          email: account.email,
          password: "a brand new passphrase",
        })
      ).statusCode,
    ).toBe(200);
    const audits = await testDatabase.connection.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, first.workspace.id));
    expect(audits.map((audit) => audit.action)).toContain(
      "credential.password_reset",
    );
  });

  it("accepts but does not send a code issued inside the minimum interval", async () => {
    const throttled: unknown[] = [];
    const spaced = buildApp(
      createAppDependencies(testDatabase.connection, undefined, {
        email,
        passwordAuth: {
          issuePolicy: { minIntervalMs: 60_000, windowMs: 0, maxPerWindow: 0 },
          onThrottled: (event) => throttled.push(event),
        },
      }),
    );
    try {
      const signedUp = await spaced.inject({
        method: "POST",
        url: "/api/auth/sign-up",
        payload: account,
      });
      expect(signedUp.statusCode).toBe(202);
      expect(email.messages).toHaveLength(1);

      const resent = await spaced.inject({
        method: "POST",
        url: "/api/auth/verify-email/resend",
        payload: { email: account.email },
      });
      expect(resent.statusCode).toBe(202);
      expect(email.messages).toHaveLength(1);
      expect(throttled).toEqual([
        expect.objectContaining({
          purpose: "verify_email",
          retryAfterMs: expect.any(Number),
        }),
      ]);

      // The first code is still the live one.
      const verified = await spaced.inject({
        method: "POST",
        url: "/api/auth/verify-email",
        payload: { email: account.email, code: email.codeFor(normalizedEmail) },
      });
      expect(verified.statusCode).toBe(200);
    } finally {
      await spaced.close();
    }
  });

  it("rejects malformed input with the public error contract", async () => {
    const malformed: [string, Record<string, unknown>][] = [
      ["/api/auth/sign-up", { ...account, password: "short" }],
      ["/api/auth/sign-up", { ...account, email: "not-an-email" }],
      ["/api/auth/verify-email", { email: account.email, code: "12345" }],
      ["/api/auth/sign-in", { email: account.email }],
      [
        "/api/auth/password-reset/confirm",
        { email: account.email, code: "123456", password: "short" },
      ],
    ];
    for (const [url, payload] of malformed) {
      const response = await post(url, payload);
      expect(response.statusCode, url).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
        "invalid_request",
      );
    }
  });
});

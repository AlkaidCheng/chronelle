import { resolve } from "node:path";

import { auditEvents } from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  acceptedResponseSchema,
  apiErrorResponseSchema,
  signInResponseSchema,
} from "@livtales/schemas";
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
  username: "person",
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
      login: account.email,
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
      login: account.email,
      password: account.password,
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signInResponseSchema.parse(signedIn.json()).user.id).toBe(
      session.user.id,
    );
    // The username signs in as well, in any case.
    const byUsername = await post("/api/auth/sign-in", {
      login: "PERSON",
      password: account.password,
    });
    expect(byUsername.statusCode).toBe(200);
    expect(signInResponseSchema.parse(byUsername.json()).user.id).toBe(
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

  it("keeps the username chosen at sign-up, refuses a taken one, and names the account by it until the Welcome step", async () => {
    // Free until taken, and never of the wrong shape.
    const free = await app.inject({
      method: "GET",
      url: "/api/auth/username-available?username=Mira_Planner",
    });
    expect(free.statusCode).toBe(200);
    expect(free.json()).toEqual({ available: true });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/auth/username-available?username=1bad",
        })
      ).json(),
    ).toEqual({ available: false });

    const chosen = await post("/api/auth/sign-up", {
      ...account,
      username: "Mira_Planner",
    });
    expect(chosen.statusCode).toBe(202);
    const verified = await post("/api/auth/verify-email", {
      email: account.email,
      code: email.codeFor(normalizedEmail),
    });
    expect(signInResponseSchema.parse(verified.json()).user.username).toBe(
      "Mira_Planner",
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/auth/username-available?username=mira_planner",
        })
      ).json(),
    ).toEqual({ available: false });

    // Another account cannot take it in any case, and none is created
    // without one or with one of the wrong shape.
    const taken = await post("/api/auth/sign-up", {
      ...account,
      email: "second@example.test",
      username: "mira_planner",
    });
    expect(taken.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(taken.json()).error.code).toBe(
      "username_taken",
    );
    const { username: _unchosen, ...withoutUsername } = account;
    expect(
      (
        await post("/api/auth/sign-up", {
          ...withoutUsername,
          email: "third@example.test",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post("/api/auth/sign-up", { ...account, username: "1bad" }))
        .statusCode,
    ).toBe(400);

    // Without a name, the account is named as its username and has the
    // Welcome step ahead; that step gives the name and completes it once.
    const { displayName: _unnamed, ...withoutName } = account;
    const unnamed = await post("/api/auth/sign-up", {
      ...withoutName,
      email: "third@example.test",
      username: "third-person",
    });
    expect(unnamed.statusCode).toBe(202);
    const third = signInResponseSchema.parse(
      (
        await post("/api/auth/verify-email", {
          email: "third@example.test",
          code: email.codeFor("third@example.test"),
        })
      ).json(),
    );
    expect(third.user).toMatchObject({
      displayName: "third-person",
      username: "third-person",
      onboardedAt: null,
    });
    const named = await app.inject({
      method: "PATCH",
      url: "/api/account",
      headers: { authorization: `Bearer ${third.accessToken}` },
      payload: { displayName: "  Third Person ", onboarded: true },
    });
    expect(named.statusCode).toBe(200);
    expect(named.json()).toMatchObject({ displayName: "Third Person" });
    const onboardedAt: unknown = named.json().onboardedAt;
    expect(typeof onboardedAt).toBe("string");
    const again = await app.inject({
      method: "PATCH",
      url: "/api/account",
      headers: { authorization: `Bearer ${third.accessToken}` },
      payload: { onboarded: true },
    });
    expect(again.json().onboardedAt).toBe(onboardedAt);
    expect((await sessionOf(third.accessToken)).json().user.displayName).toBe(
      "Third Person",
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
      login: account.email,
      password: "not the password",
    });
    expect(wrong.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(wrong.json()).error.code).toBe(
      "invalid_credentials",
    );
    const unknown = await post("/api/auth/sign-in", {
      login: "nobody@example.test",
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
        login: account.email,
        password: "wrong",
      });
      expect(failed.statusCode).toBe(401);
    }
    const locking = await post("/api/auth/sign-in", {
      login: account.email,
      password: "wrong",
    });
    expect(locking.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(locking.json()).error.code).toBe(
      "credential_locked",
    );
    const evenCorrect = await post("/api/auth/sign-in", {
      login: account.email,
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
          login: account.email,
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
          login: account.email,
          password: account.password,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await post("/api/auth/sign-in", {
          login: account.email,
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
      ["/api/auth/sign-in", { login: account.email }],
      ["/api/auth/sign-in", { email: account.email, password: "x" }],
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

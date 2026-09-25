import type { UserRow, WorkspaceRow } from "@livtales/db";

import {
  CredentialLockedError,
  EmailTakenError,
  EmailUnverifiedError,
  InvalidCredentialsError,
  VerificationInvalidError,
} from "../errors.js";
import type { WorkspaceIdentityService } from "../identity/workspace-identity-service.js";
import type { AuthIdentity } from "./auth-provider.js";
import {
  type AttemptPolicy,
  CredentialConflictError,
  type CredentialStore,
  type IssuePolicy,
  passwordIdentityProvider,
} from "./credential-store.js";
import { messagesFor } from "./email-messages.js";
import type { EmailSender } from "./email-sender.js";
import { hashPassword, verifyPassword } from "./password-hash.js";
import type {
  IssuedSession,
  SessionAuthProvider,
} from "./session-auth-provider.js";
import {
  generateVerificationCode,
  hashVerificationCode,
} from "./verification-code.js";

export interface SignUpInput {
  readonly email: string;
  readonly password: string;
  /** The username chosen at sign-up. */
  readonly username: string;
  /** The name; without one the account is named as its username until the Welcome step. */
  readonly displayName?: string | undefined;
  /** The language the sign-up screen was in; kept on the account and used for its emails. */
  readonly locale?: string | undefined;
}

export interface VerifyEmailInput {
  readonly email: string;
  readonly code: string;
}

export interface SignInInput {
  /** The email of the account, or its username. */
  readonly login: string;
  readonly password: string;
}

export interface PasswordResetInput {
  readonly email: string;
  readonly code: string;
  readonly password: string;
}

/** A signed-in password account: the session and the rows behind it. */
export interface PasswordSession extends IssuedSession {
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
}

export interface PasswordAuthOptions {
  readonly clock?: (() => Date) | undefined;
  /** How long an emailed code stays valid; fifteen minutes by default. */
  readonly verificationTtlMs?: number | undefined;
  /** Wrong codes accepted before the code is dead; five by default. */
  readonly verificationMaxAttempts?: number | undefined;
  /** Wrong passwords before the credential locks, and for how long. */
  readonly attemptPolicy?: AttemptPolicy | undefined;
  /** How often codes may be emailed for one account and purpose. */
  readonly issuePolicy?: IssuePolicy | undefined;
  /** The product name in the emails. */
  readonly productName?: string | undefined;
  /** Receives each refused code issue; the request itself still succeeds. */
  readonly onThrottled?: ((event: ThrottledIssue) => void) | undefined;
}

/** A code issue the policy refused. */
export interface ThrottledIssue {
  readonly userId: string;
  readonly purpose: "verify_email" | "reset_password";
  readonly retryAfterMs: number;
}

const defaultVerificationTtlMs = 15 * 60 * 1_000;
const defaultVerificationMaxAttempts = 5;
const defaultAttemptPolicy: AttemptPolicy = {
  maxAttempts: 10,
  lockMs: 15 * 60 * 1_000,
};
// One code a minute and five an hour: enough for a mistyped code or a lost
// email, too few for flooding a mailbox or burning the mail quota.
const defaultIssuePolicy: IssuePolicy = {
  minIntervalMs: 60 * 1_000,
  windowMs: 60 * 60 * 1_000,
  maxPerWindow: 5,
};

/**
 * Email and password accounts: sign-up records an unverified credential and
 * emails a code; verifying the code (or completing a password reset, which
 * proves the same control of the mailbox) marks the email verified and
 * signs the user in; sign-in, by email or by username, checks the password
 * against the stored hash,
 * counts failures toward a temporary lock, and refuses an unverified
 * account while re-sending its code; a password reset replaces the hash and
 * ends every session of the user. Responses never reveal whether an email
 * has an account except where the caller already proved it; a code the issue
 * policy refuses is not sent, and the request is accepted as if it were.
 */
export class PasswordAuthService {
  readonly #identity: WorkspaceIdentityService;
  readonly #credentials: CredentialStore;
  readonly #sessions: SessionAuthProvider;
  readonly #email: EmailSender;
  readonly #clock: () => Date;
  readonly #verificationTtlMs: number;
  readonly #verificationMaxAttempts: number;
  readonly #attemptPolicy: AttemptPolicy;
  readonly #issuePolicy: IssuePolicy;
  readonly #productName: string;
  readonly #onThrottled: (event: ThrottledIssue) => void;
  // A hash checked when the email has no account, so the response time does
  // not tell an unknown email from a wrong password.
  readonly #decoyHash: Promise<string>;

  constructor(
    identity: WorkspaceIdentityService,
    credentials: CredentialStore,
    sessions: SessionAuthProvider,
    email: EmailSender,
    options: PasswordAuthOptions = {},
  ) {
    this.#identity = identity;
    this.#credentials = credentials;
    this.#sessions = sessions;
    this.#email = email;
    this.#clock = options.clock ?? (() => new Date());
    this.#verificationTtlMs =
      options.verificationTtlMs ?? defaultVerificationTtlMs;
    this.#verificationMaxAttempts =
      options.verificationMaxAttempts ?? defaultVerificationMaxAttempts;
    this.#attemptPolicy = options.attemptPolicy ?? defaultAttemptPolicy;
    this.#issuePolicy = options.issuePolicy ?? defaultIssuePolicy;
    this.#productName = options.productName ?? "LivTales";
    this.#onThrottled = options.onThrottled ?? (() => undefined);
    this.#decoyHash = hashPassword(generateVerificationCode());
  }

  async signUp(input: SignUpInput, requestId: string): Promise<UserRow> {
    if ((await this.#credentials.findAccount(input.email)) !== null)
      throw new EmailTakenError();
    const passwordHash = await hashPassword(input.password);
    const session = await this.#identity.signIn(
      {
        ...this.#identityFor(input.email, input.displayName ?? input.username),
        username: input.username,
      },
      requestId,
    );
    try {
      await this.#credentials.createCredential(session.user.id, passwordHash);
    } catch (error) {
      if (error instanceof CredentialConflictError) throw new EmailTakenError();
      throw error;
    }
    const user =
      input.locale === undefined
        ? session.user
        : await this.#identity.updatePreferences(session.user.id, {
            locale: input.locale,
          });
    await this.#sendCode(user, "verify_email");
    return user;
  }

  async verifyEmail(
    input: VerifyEmailInput,
    requestId: string,
  ): Promise<PasswordSession> {
    const account = await this.#credentials.findAccount(input.email);
    if (account === null) throw new VerificationInvalidError();
    await this.#consumeCode(account.user, "verify_email", input.code);
    await this.#credentials.markEmailVerified(
      account.user.id,
      this.#clock(),
      requestId,
    );
    return this.#establish(account.user, requestId);
  }

  async resendVerification(email: string): Promise<void> {
    const account = await this.#credentials.findAccount(email);
    if (account === null || account.credential.emailVerifiedAt !== null) return;
    await this.#sendCode(account.user, "verify_email");
  }

  async signIn(
    input: SignInInput,
    requestId: string,
  ): Promise<PasswordSession> {
    const account = await this.#credentials.findAccount(input.login);
    if (account === null) {
      await verifyPassword(input.password, await this.#decoyHash);
      throw new InvalidCredentialsError();
    }
    const now = this.#clock();
    const { credential, user } = account;
    if (credential.lockedUntil !== null && credential.lockedUntil > now)
      throw new CredentialLockedError();
    const matches = await verifyPassword(
      input.password,
      credential.passwordHash,
    );
    const recorded = await this.#credentials.recordAttempt(
      user.id,
      matches,
      now,
      this.#attemptPolicy,
    );
    if (!matches) {
      if (recorded.lockedUntil !== null && recorded.lockedUntil > now)
        throw new CredentialLockedError();
      throw new InvalidCredentialsError();
    }
    if (credential.emailVerifiedAt === null) {
      await this.#sendCode(user, "verify_email");
      throw new EmailUnverifiedError();
    }
    return this.#establish(user, requestId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const account = await this.#credentials.findAccount(email);
    if (account === null) return;
    await this.#sendCode(account.user, "reset_password");
  }

  async confirmPasswordReset(
    input: PasswordResetInput,
    requestId: string,
  ): Promise<PasswordSession> {
    const account = await this.#credentials.findAccount(input.email);
    if (account === null) throw new VerificationInvalidError();
    await this.#consumeCode(account.user, "reset_password", input.code);
    const now = this.#clock();
    await this.#credentials.replacePasswordHash(
      account.user.id,
      await hashPassword(input.password),
      now,
      requestId,
    );
    if (account.credential.emailVerifiedAt === null)
      await this.#credentials.markEmailVerified(
        account.user.id,
        now,
        requestId,
      );
    await this.#sessions.revokeAll(account.user.id, requestId);
    return this.#establish(account.user, requestId);
  }

  #identityFor(email: string, displayName: string): AuthIdentity {
    return {
      provider: passwordIdentityProvider,
      subject: email,
      email,
      displayName,
    };
  }

  async #establish(user: UserRow, requestId: string): Promise<PasswordSession> {
    if (user.email === null) {
      throw new Error("A password account does not have an email address.");
    }
    const session = await this.#identity.signIn(
      this.#identityFor(user.email, user.displayName),
      requestId,
    );
    const issued = await this.#sessions.issue(
      session.user,
      passwordIdentityProvider,
    );
    return { ...issued, user: session.user, workspace: session.workspace };
  }

  async #sendCode(
    user: UserRow,
    purpose: "verify_email" | "reset_password",
  ): Promise<void> {
    if (user.email === null) {
      throw new Error("A password account does not have an email address.");
    }
    const code = generateVerificationCode();
    const issued = await this.#credentials.issueVerification(
      user.id,
      purpose,
      hashVerificationCode(user.id, purpose, code),
      new Date(this.#clock().getTime() + this.#verificationTtlMs),
      this.#issuePolicy,
    );
    if (issued.throttled) {
      this.#onThrottled({
        userId: user.id,
        purpose,
        retryAfterMs: issued.retryAfterMs,
      });
      return;
    }
    const message = messagesFor(user.locale).codeEmail({
      productName: this.#productName,
      code,
      purpose,
      expiresInMinutes: Math.round(this.#verificationTtlMs / 60_000),
    });
    await this.#email.send({ to: user.email, ...message });
  }

  async #consumeCode(
    user: UserRow,
    purpose: "verify_email" | "reset_password",
    code: string,
  ): Promise<void> {
    const outcome = await this.#credentials.consumeVerification(
      user.id,
      purpose,
      hashVerificationCode(user.id, purpose, code),
      this.#clock(),
      this.#verificationMaxAttempts,
    );
    if (outcome !== "consumed") throw new VerificationInvalidError();
  }
}

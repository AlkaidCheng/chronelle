import {
  acceptedResponseSchema,
  emailRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordSignInRequestSchema,
  signInResponseSchema,
  signUpRequestSchema,
  verifyEmailRequestSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";

import { parseRequest } from "../request-validation.js";
import type {
  PasswordAuthService,
  PasswordSession,
} from "./password-auth-service.js";

export interface PasswordRouteDependencies {
  readonly passwordAuth: PasswordAuthService;
}

function signedIn(session: PasswordSession) {
  return signInResponseSchema.parse({
    accessToken: session.accessToken,
    tokenType: "Bearer",
    expiresAt: session.expiresAt.toISOString(),
    user: {
      id: session.user.id,
      displayName: session.user.displayName,
      email: session.user.email,
    },
    workspace: {
      id: session.workspace.id,
      displayName: session.workspace.displayName,
    },
  });
}

const accepted = () => acceptedResponseSchema.parse({ accepted: true });

/** Email and password sign-up, verification, sign-in, and password reset. */
export function registerPasswordRoutes(
  app: FastifyInstance,
  dependencies: PasswordRouteDependencies,
): void {
  app.post("/api/auth/sign-up", async (request, reply) => {
    const input = parseRequest(signUpRequestSchema, request.body);
    await dependencies.passwordAuth.signUp(input, request.id);
    return reply.code(202).send(accepted());
  });

  app.post("/api/auth/verify-email", async (request) => {
    const input = parseRequest(verifyEmailRequestSchema, request.body);
    return signedIn(
      await dependencies.passwordAuth.verifyEmail(input, request.id),
    );
  });

  app.post("/api/auth/verify-email/resend", async (request, reply) => {
    const input = parseRequest(emailRequestSchema, request.body);
    await dependencies.passwordAuth.resendVerification(input.email);
    return reply.code(202).send(accepted());
  });

  app.post("/api/auth/sign-in", async (request) => {
    const input = parseRequest(passwordSignInRequestSchema, request.body);
    return signedIn(await dependencies.passwordAuth.signIn(input, request.id));
  });

  app.post("/api/auth/password-reset", async (request, reply) => {
    const input = parseRequest(emailRequestSchema, request.body);
    await dependencies.passwordAuth.requestPasswordReset(input.email);
    return reply.code(202).send(accepted());
  });

  app.post("/api/auth/password-reset/confirm", async (request) => {
    const input = parseRequest(passwordResetConfirmRequestSchema, request.body);
    return signedIn(
      await dependencies.passwordAuth.confirmPasswordReset(input, request.id),
    );
  });
}

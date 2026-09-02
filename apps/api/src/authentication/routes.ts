import {
  developmentSignInRequestSchema,
  developmentSignInResponseSchema,
  sessionResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";

import type { WorkspaceIdentityService } from "../identity/workspace-identity-service.js";
import { InvalidRequestError, UnauthenticatedError } from "../errors.js";
import type { DevelopmentAuthProvider } from "./development-auth-provider.js";

export interface DevelopmentAuthenticationRouteDependencies {
  readonly developmentAuth: DevelopmentAuthProvider;
  readonly identity: WorkspaceIdentityService;
}

export function registerDevelopmentAuthenticationRoute(
  app: FastifyInstance,
  dependencies: DevelopmentAuthenticationRouteDependencies,
): void {
  app.post("/api/auth/development/sign-in", async (request) => {
    const parsedInput = developmentSignInRequestSchema.safeParse(request.body);
    if (!parsedInput.success) {
      throw new InvalidRequestError();
    }
    const credential = dependencies.developmentAuth.issueCredential(
      parsedInput.data,
    );

    try {
      const session = await dependencies.identity.signIn(
        credential.identity,
        request.id,
      );
      return developmentSignInResponseSchema.parse({
        accessToken: credential.accessToken,
        tokenType: "Bearer",
        expiresAt: credential.expiresAt.toISOString(),
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
    } catch (error) {
      dependencies.developmentAuth.revoke(credential.accessToken);
      throw error;
    }
  });
}

export function registerSessionRoute(app: FastifyInstance): void {
  app.get(
    "/api/auth/session",
    { preHandler: app.authenticate },
    async (request) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const session = request.identitySession;

      return sessionResponseSchema.parse({
        principal: session.principal,
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
    },
  );
}

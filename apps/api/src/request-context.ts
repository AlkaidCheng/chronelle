import type { UserPrincipal } from "@chronelle/authorization";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AuthProvider } from "./authentication/auth-provider.js";
import { UnauthenticatedError, WorkspaceUnavailableError } from "./errors.js";
import type {
  IdentitySession,
  WorkspaceIdentityService,
} from "./identity/workspace-identity-service.js";

declare module "fastify" {
  interface FastifyRequest {
    identitySession: IdentitySession | null;
    principal: UserPrincipal | null;
  }

  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>;
  }
}

export interface RequestContextDependencies {
  readonly authProvider: AuthProvider;
  readonly identity: WorkspaceIdentityService;
}

export function requirePrincipal(request: FastifyRequest): UserPrincipal {
  if (request.principal === null) {
    throw new UnauthenticatedError();
  }
  return request.principal;
}

export function readBearerToken(
  authorizationHeader: string | undefined,
): string {
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader ?? "");
  if (match?.[1] === undefined) {
    throw new UnauthenticatedError();
  }
  return match[1];
}

function readWorkspaceId(
  header: string | string[] | undefined,
): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  if (typeof header !== "string") {
    throw new WorkspaceUnavailableError();
  }

  const result = z.uuid().safeParse(header);
  if (!result.success) {
    throw new WorkspaceUnavailableError();
  }
  return result.data;
}

/**
 * The object a route names in its `id` parameter, when it is one; the
 * session then follows the object's workspace, so a share opens where it
 * lives. Any other identifier in that place leaves the session where the
 * header put it.
 */
function readObjectId(params: unknown): string | undefined {
  if (params === null || typeof params !== "object") return undefined;
  const result = z.uuid().safeParse((params as { id?: unknown }).id);
  return result.success ? result.data : undefined;
}

export function registerRequestContext(
  app: FastifyInstance,
  dependencies: RequestContextDependencies,
): void {
  app.decorateRequest("principal", null);
  app.decorateRequest("identitySession", null);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const accessToken = readBearerToken(request.headers.authorization);
    const authenticated =
      await dependencies.authProvider.authenticate(accessToken);
    if (authenticated === null) {
      throw new UnauthenticatedError();
    }

    const workspaceId = readWorkspaceId(request.headers["x-workspace-id"]);
    const session = await dependencies.identity.resolvePrincipal(
      authenticated.userId,
      workspaceId,
      readObjectId(request.params),
    );
    request.identitySession = session;
    request.principal = session.principal;
  });
}

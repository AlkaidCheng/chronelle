import type { UserPrincipal } from "@livtales/authorization";
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

  interface FastifyContextConfig {
    /**
     * The object whose workspace the session follows, for a route that
     * names it somewhere other than its `id` parameter.
     */
    readonly followsObject?: (request: FastifyRequest) => unknown;
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
 * The object a request names, when it is one: in the place the route's
 * `followsObject` reads, else in its `id` parameter. The session then
 * follows the object's workspace, so a share opens and saves where it
 * lives. Any other identifier leaves the session where the header put it.
 */
function readObjectId(request: FastifyRequest): string | undefined {
  const named =
    request.routeOptions.config.followsObject?.(request) ??
    (request.params as { id?: unknown } | null | undefined)?.id;
  const result = z.uuid().safeParse(named);
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
      readObjectId(request),
    );
    request.identitySession = session;
    request.principal = session.principal;
  });
}

import {
  accountUpdateRequestSchema,
  developmentSignInRequestSchema,
  developmentSignInResponseSchema,
  preferencesRequestSchema,
  sessionRevocationResponseSchema,
  sessionResponseSchema,
  usernameAvailabilityQuerySchema,
  usernameAvailabilityResponseSchema,
  usernameParamsSchema,
  userResponseSchema,
  userSearchQuerySchema,
  userSearchResponseSchema,
  userSummarySchema,
} from "@chronelle/schemas";
import type { UserRow } from "@chronelle/db";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { WorkspaceIdentityService } from "../identity/workspace-identity-service.js";
import {
  InvalidRequestError,
  SearchLimitError,
  UnauthenticatedError,
} from "../errors.js";
import { readBearerToken } from "../request-context.js";
import { parseRequest } from "../request-validation.js";
import {
  developmentIdentity,
  developmentIdentityProvider,
} from "./development-identity.js";
import { SearchAllowance } from "./search-allowance.js";
import type { SessionAuthProvider } from "./session-auth-provider.js";

export interface DevelopmentAuthenticationRouteDependencies {
  readonly identity: WorkspaceIdentityService;
  readonly sessions: SessionAuthProvider;
}

export interface SessionRouteDependencies {
  readonly identity: WorkspaceIdentityService;
  readonly sessions: SessionAuthProvider;
  /** How many searches one account may run in a minute. */
  readonly searchesPerMinute?: number | undefined;
}

export function registerDevelopmentAuthenticationRoute(
  app: FastifyInstance,
  dependencies: DevelopmentAuthenticationRouteDependencies,
): void {
  app.post("/api/auth/development/sign-in", async (request) => {
    const input = parseRequest(developmentSignInRequestSchema, request.body);
    const session = await dependencies.identity.signIn(
      developmentIdentity(input),
      request.id,
    );
    const credential = await dependencies.sessions.issue(
      session.user,
      developmentIdentityProvider,
    );
    return developmentSignInResponseSchema.parse({
      accessToken: credential.accessToken,
      tokenType: "Bearer",
      expiresAt: credential.expiresAt.toISOString(),
      user: userPayload(session.user),
      workspace: {
        id: session.workspace.id,
        displayName: session.workspace.displayName,
      },
    });
  });
}

/** The account fields every session-shaped response carries. */
export function userPayload(user: UserRow) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    username: user.username,
    findByName: user.findByName,
    findByEmail: user.findByEmail,
    onboardedAt: user.onboardedAt?.toISOString() ?? null,
    locale: user.locale,
    timeZone: user.timeZone,
    hourCycle: user.hourCycle,
    weekStart: user.weekStart,
    rail: user.rail,
    eventTabs: user.eventTabs,
  };
}

/** Whether the runtime knows the zone: the schema checks the shape, this checks the name. */
export function isKnownTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function registerSessionRoutes(
  app: FastifyInstance,
  dependencies: SessionRouteDependencies,
): void {
  app.get(
    "/api/auth/session",
    { preHandler: app.authenticate },
    async (request) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const session = request.identitySession;
      const availableWorkspaces =
        await dependencies.identity.listAccessibleWorkspaces(
          session.user.id,
          session.workspace.id,
        );

      return sessionResponseSchema.parse({
        principal: session.principal,
        user: userPayload(session.user),
        workspace: {
          id: session.workspace.id,
          displayName: session.workspace.displayName,
        },
        availableWorkspaces: availableWorkspaces.map((workspace) => ({
          id: workspace.id,
          displayName: workspace.displayName,
        })),
      });
    },
  );

  // The preferences kept on the account: each key present replaces the
  // stored value and null clears it. The response is the account as the
  // next session read will show it.
  app.patch(
    "/api/auth/me",
    { preHandler: app.authenticate },
    async (request) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const input = parseRequest(preferencesRequestSchema, request.body);
      if (
        typeof input.timeZone === "string" &&
        !isKnownTimeZone(input.timeZone)
      )
        throw new InvalidRequestError();
      const user = await dependencies.identity.updatePreferences(
        request.identitySession.user.id,
        input,
      );
      return userResponseSchema.parse(userPayload(user));
    },
  );

  // The discovery switches: each key present replaces the stored value.
  // The username is chosen once, at sign-up, and is not changed here.
  app.patch(
    "/api/account",
    { preHandler: app.authenticate },
    async (request) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const input = parseRequest(accountUpdateRequestSchema, request.body);
      const user = await dependencies.identity.updateAccount(
        request.identitySession.user.id,
        input,
      );
      return userResponseSchema.parse(userPayload(user));
    },
  );

  // Whether a username is free, for the sign-up screen, which needs no
  // session; usernames are public handles, and the answer is capped per
  // address like a search.
  const searches = new SearchAllowance(dependencies.searchesPerMinute ?? 60);
  app.get("/api/auth/username-available", async (request) => {
    const { username } = parseRequest(
      usernameAvailabilityQuerySchema,
      request.query,
    );
    if (!searches.take(`ip:${request.ip}`, Date.now()))
      throw new SearchLimitError();
    return usernameAvailabilityResponseSchema.parse({
      available: await dependencies.identity.usernameAvailable(username),
    });
  });

  // Find people: accounts by @username, name, or exact email, as each
  // account lets itself be found; at most ten, the searcher left out.
  app.get(
    "/api/users/search",
    { preHandler: app.authenticate },
    async (request) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const { q } = parseRequest(userSearchQuerySchema, request.query);
      const userId = request.identitySession.user.id;
      if (!searches.take(userId, Date.now())) throw new SearchLimitError();
      const items = await dependencies.identity.searchUsers(userId, q);
      return userSearchResponseSchema.parse({ items });
    },
  );

  // The account behind a code, by username.
  app.get(
    "/api/users/:username",
    { preHandler: app.authenticate },
    async (request) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const { username } = parseRequest(usernameParamsSchema, request.params);
      const summary = await dependencies.identity.lookupUser(
        request.identitySession.user.id,
        username,
      );
      return userSummarySchema.parse(summary);
    },
  );

  // Signing out revokes the presented credential; the count is 0 when a
  // concurrent sign-out already ended it.
  app.delete(
    "/api/auth/session",
    { preHandler: app.authenticate },
    async (request: FastifyRequest) => {
      const revoked = await dependencies.sessions.revoke(
        readBearerToken(request.headers.authorization),
        request.id,
      );
      return sessionRevocationResponseSchema.parse({
        revoked: revoked ? 1 : 0,
      });
    },
  );

  app.delete(
    "/api/auth/sessions",
    { preHandler: app.authenticate },
    async (request: FastifyRequest) => {
      if (request.identitySession === null) {
        throw new UnauthenticatedError();
      }
      const revoked = await dependencies.sessions.revokeAll(
        request.identitySession.user.id,
        request.id,
      );
      return sessionRevocationResponseSchema.parse({ revoked });
    },
  );
}

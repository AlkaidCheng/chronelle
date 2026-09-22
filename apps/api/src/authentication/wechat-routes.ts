import {
  signInResponseSchema,
  weChatCredentialRequestSchema,
  weChatIdentityLinkResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";

import { AuthenticationLimitError, UnauthenticatedError } from "../errors.js";
import { parseRequest } from "../request-validation.js";
import { userPayload } from "./routes.js";
import { SearchAllowance } from "./search-allowance.js";
import type { WeChatAuthenticationService } from "./wechat-auth-service.js";

export interface WeChatAuthenticationRouteDependencies {
  readonly authentication: Pick<
    WeChatAuthenticationService,
    "exchange" | "link"
  >;
  readonly exchangesPerMinute?: number | undefined;
  readonly linksPerMinute?: number | undefined;
}

export function registerWeChatAuthenticationRoutes(
  app: FastifyInstance,
  dependencies: WeChatAuthenticationRouteDependencies,
): void {
  const exchanges = new SearchAllowance(dependencies.exchangesPerMinute ?? 10);
  const links = new SearchAllowance(dependencies.linksPerMinute ?? 5);

  app.post("/api/auth/wechat", async (request) => {
    if (!exchanges.take(`ip:${request.ip}`, Date.now())) {
      throw new AuthenticationLimitError();
    }
    const input = parseRequest(weChatCredentialRequestSchema, request.body);
    const session = await dependencies.authentication.exchange(
      input,
      request.id,
    );
    return signInResponseSchema.parse({
      accessToken: session.accessToken,
      tokenType: "Bearer",
      expiresAt: session.expiresAt.toISOString(),
      user: userPayload(session.user),
      workspace: {
        id: session.workspace.id,
        displayName: session.workspace.displayName,
      },
    });
  });

  app.post(
    "/api/auth/wechat/link",
    { preHandler: app.authenticate },
    async (request) => {
      const session = request.identitySession;
      if (session === null) throw new UnauthenticatedError();
      if (!links.take(session.user.id, Date.now())) {
        throw new AuthenticationLimitError();
      }
      const input = parseRequest(weChatCredentialRequestSchema, request.body);
      await dependencies.authentication.link(
        session.user.id,
        input,
        request.id,
      );
      return weChatIdentityLinkResponseSchema.parse({ linked: true });
    },
  );
}

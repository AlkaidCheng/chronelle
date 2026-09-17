import { healthStatusSchema } from "@chronelle/schemas";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { registerPasswordRoutes } from "./authentication/password-routes.js";
import {
  registerDevelopmentAuthenticationRoute,
  registerSessionRoutes,
} from "./authentication/routes.js";
import { registerCommandRoutes } from "./commands/routes.js";
import type { AppDependencies } from "./dependencies.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { registerEventPageRoutes } from "./event-pages/routes.js";
import { registerEventPlanningRoutes } from "./event-planning/routes.js";
import { registerFriendRoutes } from "./friends/routes.js";
import { httpServerOptions, registerHttpBoundary } from "./http-boundary.js";
import { registerLabelRoutes } from "./labels/routes.js";
import { registerRecoveryRoutes } from "./recovery/routes.js";
import { registerRequestContext } from "./request-context.js";
import { registerRevisionRoutes } from "./revisions/routes.js";
import { registerSearchRoutes } from "./search/routes.js";
import { registerSharingRoutes } from "./sharing/routes.js";
import { registerStorageInventoryRoutes } from "./storage-inventory/routes.js";

export function buildApp(
  dependencies: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify({ ...options, ...httpServerOptions });
  registerHttpBoundary(app);

  registerRequestContext(app, dependencies);
  registerSessionRoutes(app, {
    identity: dependencies.identity,
    sessions: dependencies.sessions,
  });
  registerPasswordRoutes(app, {
    passwordAuth: dependencies.passwordAuth,
    friends: dependencies.friends,
  });
  registerFriendRoutes(app, { friends: dependencies.friends });
  registerDocumentRoutes(app, dependencies);
  registerEventPlanningRoutes(app, dependencies);
  registerLabelRoutes(app, dependencies);
  registerEventPageRoutes(app, dependencies);
  registerSearchRoutes(app, dependencies);
  registerSharingRoutes(app, dependencies);
  registerRevisionRoutes(app, dependencies);
  registerRecoveryRoutes(app, dependencies);
  registerCommandRoutes(app, dependencies);
  registerStorageInventoryRoutes(app, dependencies);
  if (dependencies.developmentSignIn) {
    registerDevelopmentAuthenticationRoute(app, {
      identity: dependencies.identity,
      sessions: dependencies.sessions,
    });
  }

  app.get("/api/health", async () =>
    healthStatusSchema.parse({
      service: "chronelle-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );

  return app;
}

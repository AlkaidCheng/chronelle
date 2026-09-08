import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { healthStatusSchema } from "@chronelle/schemas";

import {
  registerDevelopmentAuthenticationRoute,
  registerSessionRoute,
} from "./authentication/routes.js";
import type { AppDependencies } from "./dependencies.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { httpServerOptions, registerHttpBoundary } from "./http-boundary.js";
import { registerEventPlanningRoutes } from "./event-planning/routes.js";
import { registerEventPageRoutes } from "./event-pages/routes.js";
import { registerRequestContext } from "./request-context.js";
import { registerSearchRoutes } from "./search/routes.js";
import { registerSharingRoutes } from "./sharing/routes.js";
import { registerRevisionRoutes } from "./revisions/routes.js";
import { registerRecoveryRoutes } from "./recovery/routes.js";
import { registerCommandRoutes } from "./commands/routes.js";
import { registerStorageInventoryRoutes } from "./storage-inventory/routes.js";

export function buildApp(
  dependencies: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify({ ...options, ...httpServerOptions });
  registerHttpBoundary(app);

  registerRequestContext(app, dependencies);
  registerSessionRoute(app, { identity: dependencies.identity });
  registerDocumentRoutes(app, dependencies);
  registerEventPlanningRoutes(app, dependencies);
  registerEventPageRoutes(app, dependencies);
  registerSearchRoutes(app, dependencies);
  registerSharingRoutes(app, dependencies);
  registerRevisionRoutes(app, dependencies);
  registerRecoveryRoutes(app, dependencies);
  registerCommandRoutes(app, dependencies);
  registerStorageInventoryRoutes(app, dependencies);
  if (dependencies.developmentAuth !== undefined) {
    registerDevelopmentAuthenticationRoute(app, {
      developmentAuth: dependencies.developmentAuth,
      identity: dependencies.identity,
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

import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { createId } from "@chronelle/db";
import { healthStatusSchema } from "@chronelle/schemas";

import {
  registerDevelopmentAuthenticationRoute,
  registerSessionRoute,
} from "./authentication/routes.js";
import type { AppDependencies } from "./dependencies.js";
import { HttpError } from "./errors.js";
import { registerRequestContext } from "./request-context.js";

export function buildApp(
  dependencies: AppDependencies,
  options: FastifyServerOptions = {},
): FastifyInstance {
  const app = Fastify({ ...options, genReqId: createId });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    request.log.error({ error }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
      },
    });
  });

  registerRequestContext(app, dependencies);
  registerSessionRoute(app);
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

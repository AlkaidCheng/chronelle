import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import {
  AuthorizationDeniedError,
  InvalidShareError,
  PrincipalUnavailableError,
} from "@chronelle/authorization";
import { createId } from "@chronelle/db";
import {
  DocumentTransferUnavailableError,
  InvalidDocumentUploadError,
  InvalidObjectStateError,
  InvalidRelationError,
  ObjectConflictError,
  CommandConflictError,
  RelationConflictError,
} from "@chronelle/object-model";
import { healthStatusSchema } from "@chronelle/schemas";
import {
  StorageObjectConflictError,
  StorageObjectUnavailableError,
  UnsafeStorageKeyError,
} from "@chronelle/storage";

import {
  registerDevelopmentAuthenticationRoute,
  registerSessionRoute,
} from "./authentication/routes.js";
import type { AppDependencies } from "./dependencies.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { HttpError } from "./errors.js";
import { registerEventPlanningRoutes } from "./event-planning/routes.js";
import { registerRequestContext } from "./request-context.js";
import { registerSearchRoutes } from "./search/routes.js";
import { registerSharingRoutes } from "./sharing/routes.js";
import { registerRevisionRoutes } from "./revisions/routes.js";
import { registerRecoveryRoutes } from "./recovery/routes.js";

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
    if (error instanceof AuthorizationDeniedError) {
      return reply.status(404).send({
        error: {
          code: "resource_unavailable",
          message: "The requested resource is unavailable.",
        },
      });
    }
    if (error instanceof PrincipalUnavailableError) {
      return reply.status(404).send({
        error: { code: "principal_unavailable", message: error.message },
      });
    }
    if (error instanceof InvalidShareError) {
      return reply.status(400).send({
        error: { code: "invalid_share", message: error.message },
      });
    }
    if (error instanceof CommandConflictError) {
      return reply
        .status(409)
        .send({ error: { code: "command_conflict", message: error.message } });
    }
    if (error instanceof ObjectConflictError) {
      return reply.status(409).send({
        error: { code: "version_conflict", message: error.message },
      });
    }
    if (error instanceof RelationConflictError) {
      return reply.status(409).send({
        error: { code: "relation_conflict", message: error.message },
      });
    }
    if (
      error instanceof DocumentTransferUnavailableError ||
      error instanceof StorageObjectUnavailableError
    ) {
      return reply.status(404).send({
        error: {
          code: "transfer_unavailable",
          message: "The document transfer is unavailable.",
        },
      });
    }
    if (error instanceof StorageObjectConflictError) {
      return reply.status(409).send({
        error: {
          code: "storage_conflict",
          message: "The document transfer conflicts with stored content.",
        },
      });
    }
    if (
      error instanceof InvalidObjectStateError ||
      error instanceof InvalidRelationError ||
      error instanceof InvalidDocumentUploadError ||
      error instanceof UnsafeStorageKeyError
    ) {
      return reply.status(400).send({
        error: { code: "invalid_request", message: error.message },
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
  registerSessionRoute(app, { identity: dependencies.identity });
  registerDocumentRoutes(app, dependencies);
  registerEventPlanningRoutes(app, dependencies);
  registerSearchRoutes(app, dependencies);
  registerSharingRoutes(app, dependencies);
  registerRevisionRoutes(app, dependencies);
  registerRecoveryRoutes(app, dependencies);
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

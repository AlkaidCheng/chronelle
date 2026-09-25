import {
  serializeResource,
  type ObjectRevisionService,
  type ObjectRestorationService,
} from "@livtales/object-model";
import {
  objectIdParamsSchema,
  revisionListQuerySchema,
  revisionListResponseSchema,
  revisionParamsSchema,
  revisionResponseSchema,
  revisionComparisonQuerySchema,
  revisionComparisonResponseSchema,
  revisionRestorePreviewSchema,
  revisionRestoreRequestSchema,
  eventPlanningResourceResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export function registerRevisionRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly revisions: ObjectRevisionService;
    readonly restoration: ObjectRestorationService;
  },
): void {
  app.get(
    "/api/objects/:id/revisions/compare",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const query = parseRequest(revisionComparisonQuerySchema, request.query);
      return revisionComparisonResponseSchema.parse(
        await dependencies.restoration.compare(
          requirePrincipal(request),
          id,
          query,
        ),
      );
    },
  );
  app.get(
    "/api/objects/:id/revisions/:version/restore-preview",
    { preHandler: app.authenticate },
    async (request) => {
      const { id, version } = parseRequest(
        revisionParamsSchema,
        request.params,
      );
      return revisionRestorePreviewSchema.parse(
        await dependencies.restoration.preview(
          requirePrincipal(request),
          id,
          version,
        ),
      );
    },
  );
  app.post(
    "/api/objects/:id/revisions/:version/restore",
    { preHandler: app.authenticate },
    async (request) => {
      const { id, version } = parseRequest(
        revisionParamsSchema,
        request.params,
      );
      const input = parseRequest(revisionRestoreRequestSchema, request.body);
      const resource = await dependencies.restoration.restore(
        { principal: requirePrincipal(request), requestId: request.id },
        id,
        version,
        input,
      );
      return eventPlanningResourceResponseSchema.parse(
        serializeResource(resource),
      );
    },
  );
  app.get(
    "/api/objects/:id/revisions",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const query = parseRequest(revisionListQuerySchema, request.query);
      return revisionListResponseSchema.parse(
        await dependencies.revisions.list(requirePrincipal(request), id, query),
      );
    },
  );

  app.get(
    "/api/objects/:id/revisions/:version",
    { preHandler: app.authenticate },
    async (request) => {
      const { id, version } = parseRequest(
        revisionParamsSchema,
        request.params,
      );
      return revisionResponseSchema.parse(
        await dependencies.revisions.get(
          requirePrincipal(request),
          id,
          version,
        ),
      );
    },
  );
}

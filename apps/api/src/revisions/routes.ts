import type { ObjectRevisionService } from "@chronelle/object-model";
import {
  objectIdParamsSchema,
  revisionListQuerySchema,
  revisionListResponseSchema,
  revisionParamsSchema,
  revisionResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export function registerRevisionRoutes(
  app: FastifyInstance,
  dependencies: { readonly revisions: ObjectRevisionService },
): void {
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

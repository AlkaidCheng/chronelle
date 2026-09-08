import type { EventLayoutService } from "@chronelle/object-model";
import {
  eventLayoutResponseSchema,
  eventLayoutUpdateSchema,
  objectIdParamsSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export function registerEventPageRoutes(
  app: FastifyInstance,
  dependencies: { readonly eventLayouts: EventLayoutService },
): void {
  app.get(
    "/api/events/:id/layout",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      return eventLayoutResponseSchema.parse(
        await dependencies.eventLayouts.get(requirePrincipal(request), id),
      );
    },
  );
  app.patch(
    "/api/events/:id/layout",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(eventLayoutUpdateSchema, request.body);
      return eventLayoutResponseSchema.parse(
        await dependencies.eventLayouts.update(
          { principal: requirePrincipal(request), requestId: request.id },
          id,
          input,
        ),
      );
    },
  );
}

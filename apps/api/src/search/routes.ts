import type { CanonicalObjectSearchService } from "@livtales/object-model";
import {
  objectSearchQuerySchema,
  objectSearchResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export interface SearchRouteDependencies {
  readonly search: CanonicalObjectSearchService;
}

export function registerSearchRoutes(
  app: FastifyInstance,
  dependencies: SearchRouteDependencies,
): void {
  app.get("/api/search", { preHandler: app.authenticate }, async (request) => {
    const input = parseRequest(objectSearchQuerySchema, request.query);
    const page = await dependencies.search.search(
      requirePrincipal(request),
      input,
    );
    return objectSearchResponseSchema.parse({
      nextCursor: page.nextCursor,
      items: page.items.map((item) => ({
        ...item,
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  });
}

import {
  type ObjectMoveRepository,
  serializeResource,
} from "@livtales/object-model";
import {
  objectIdParamsSchema,
  objectMovePreviewQuerySchema,
  objectMovePreviewSchema,
  objectMoveRequestSchema,
  objectMoveResponseSchema,
  objectMoveTargetsResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export interface MoveRouteDependencies {
  readonly moves: ObjectMoveRepository;
}

/**
 * Moving an Event to another space: the spaces it can go to, a preview of
 * what moves and what stays behind, and the move. Each names the Event by
 * its `id`, so the session follows the Event's space, where an Owner moves
 * it.
 */
export function registerMoveRoutes(
  app: FastifyInstance,
  dependencies: MoveRouteDependencies,
): void {
  app.get(
    "/api/objects/:id/move/targets",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      return objectMoveTargetsResponseSchema.parse(
        await dependencies.moves.targets(requirePrincipal(request), id),
      );
    },
  );

  app.get(
    "/api/objects/:id/move",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const { to } = parseRequest(objectMovePreviewQuerySchema, request.query);
      return objectMovePreviewSchema.parse(
        await dependencies.moves.preview(requirePrincipal(request), id, to),
      );
    },
  );

  app.post(
    "/api/objects/:id/move",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(objectMoveRequestSchema, request.body);
      const { event, move } = await dependencies.moves.move(
        { principal: requirePrincipal(request), requestId: request.id },
        id,
        input,
      );
      return objectMoveResponseSchema.parse({
        event: serializeResource(event),
        move,
      });
    },
  );
}

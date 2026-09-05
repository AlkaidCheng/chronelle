import type {
  ObjectRecoveryService,
  ObjectRelationService,
} from "@chronelle/object-model";
import { serializeResource } from "@chronelle/object-model";
import {
  objectIdParamsSchema,
  trashQuerySchema,
  trashListResponseSchema,
  recoveryRequestSchema,
  recoveryPreviewSchema,
  eventPlanningResourceResponseSchema,
  relationResponseSchema,
  removedRelationQuerySchema,
  removedRelationListResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";
import { parseRequest } from "../request-validation.js";
import { requirePrincipal } from "../request-context.js";
import { serializeRelation } from "../event-planning/serialization.js";

export function registerRecoveryRoutes(
  app: FastifyInstance,
  dependencies: {
    recovery: ObjectRecoveryService;
    relations: ObjectRelationService;
  },
) {
  app.get("/api/trash", { preHandler: app.authenticate }, async (request) => {
    const input = parseRequest(trashQuerySchema, request.query);
    return trashListResponseSchema.parse(
      await dependencies.recovery.list(requirePrincipal(request), input),
    );
  });
  app.get(
    "/api/objects/:id/recovery-preview",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      return recoveryPreviewSchema.parse(
        await dependencies.recovery.preview(requirePrincipal(request), id),
      );
    },
  );
  app.post(
    "/api/objects/:id/recover",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(recoveryRequestSchema, request.body);
      const saved = await dependencies.recovery.recover(
        { principal: requirePrincipal(request), requestId: request.id },
        id,
        input,
      );
      return eventPlanningResourceResponseSchema.parse(
        serializeResource(saved),
      );
    },
  );
  app.get(
    "/api/objects/:id/removed-relations",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(removedRelationQuerySchema, request.query);
      const page = await dependencies.relations.listRemoved(
        requirePrincipal(request),
        id,
        input,
      );
      return removedRelationListResponseSchema.parse({
        ...page,
        items: page.items.map((entry) => ({
          ...entry,
          relation: serializeRelation(entry.relation),
        })),
      });
    },
  );
  app.post(
    "/api/relations/:id/recover",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(recoveryRequestSchema, request.body);
      const relation = await dependencies.relations.recover(
        { principal: requirePrincipal(request), requestId: request.id },
        id,
        input.expectedVersion,
      );
      return relationResponseSchema.parse(serializeRelation(relation));
    },
  );
}

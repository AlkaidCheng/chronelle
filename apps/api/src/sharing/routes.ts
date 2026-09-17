import type {
  GrantMutationContext,
  ResourceGrantResource,
  ResourceGrantService,
} from "@chronelle/authorization";
import type { EventPlanningObjectService } from "@chronelle/object-model";
import {
  eventPlanningResourceResponseSchema,
  objectAccessResponseSchema,
  objectIdParamsSchema,
  pendingShareCreateRequestSchema,
  pendingShareRevocationResponseSchema,
  pendingShareSchema,
  permissionScopeUpdateRequestSchema,
  shareCreateRequestSchema,
  shareListResponseSchema,
  shareResponseSchema,
  shareRevocationResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { serializeResource } from "../event-planning/serialization.js";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";
import type { PendingShareService } from "./pending-share-service.js";
import type { PendingShareView } from "./pending-share-store.js";

export interface SharingRouteDependencies {
  readonly objects: EventPlanningObjectService;
  readonly shares: ResourceGrantService;
  readonly pendingShares: PendingShareService;
}

function mutationContext(request: FastifyRequest): GrantMutationContext {
  return { principal: requirePrincipal(request), requestId: request.id };
}

function serializeShare(grant: ResourceGrantResource) {
  return {
    ...grant,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt?.toISOString() ?? null,
  };
}

function serializePending(pending: PendingShareView) {
  return { ...pending, createdAt: pending.createdAt.toISOString() };
}

export function registerSharingRoutes(
  app: FastifyInstance,
  dependencies: SharingRouteDependencies,
): void {
  app.get(
    "/api/objects/:id/access",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const principal = requirePrincipal(request);
      const access = await dependencies.objects.getAccess(principal, id);
      return objectAccessResponseSchema.parse({ resourceId: id, ...access });
    },
  );

  app.get(
    "/api/objects/:id/shares",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const principal = requirePrincipal(request);
      const [grants, pending] = await Promise.all([
        dependencies.shares.list(principal, id),
        dependencies.pendingShares.list(principal, id),
      ]);
      return shareListResponseSchema.parse({
        items: grants.map(serializeShare),
        pending: pending.map(serializePending),
      });
    },
  );

  app.post(
    "/api/shares/pending",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(pendingShareCreateRequestSchema, request.body);
      const pending = await dependencies.pendingShares.queueForPerson(
        mutationContext(request),
        input,
      );
      return reply
        .code(201)
        .send(pendingShareSchema.parse(serializePending(pending)));
    },
  );

  app.delete(
    "/api/shares/pending/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const revoked = await dependencies.pendingShares.revoke(
        mutationContext(request),
        id,
      );
      return pendingShareRevocationResponseSchema.parse({
        id: revoked.id,
        revokedAt: revoked.revokedAt.toISOString(),
      });
    },
  );

  app.post(
    "/api/shares",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(shareCreateRequestSchema, request.body);
      const grant = await dependencies.shares.share(
        mutationContext(request),
        input,
      );
      return reply
        .code(201)
        .send(shareResponseSchema.parse(serializeShare(grant)));
    },
  );

  app.delete(
    "/api/shares/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const revoked = await dependencies.shares.revoke(
        mutationContext(request),
        id,
      );
      return shareRevocationResponseSchema.parse({
        id: revoked.id,
        revokedAt: revoked.revokedAt.toISOString(),
      });
    },
  );

  app.patch(
    "/api/objects/:id/permission-scope",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(
        permissionScopeUpdateRequestSchema,
        request.body,
      );
      const resource = await dependencies.objects.updatePermissionScope(
        mutationContext(request),
        id,
        input,
      );
      return eventPlanningResourceResponseSchema.parse(
        serializeResource(resource),
      );
    },
  );
}

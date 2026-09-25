import type { LabelResource, LabelService } from "@livtales/object-model";
import {
  labelCreateRequestSchema,
  labelDeleteQuerySchema,
  labelListResponseSchema,
  labelResponseSchema,
  labelUpdateRequestSchema,
  objectIdParamsSchema,
  type LabelResponse,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

function serializeLabel(label: LabelResource): LabelResponse {
  return {
    id: label.id,
    workspaceId: label.workspaceId,
    name: label.name,
    version: label.version,
    createdAt: label.createdAt.toISOString(),
    updatedAt: label.updatedAt.toISOString(),
  };
}

/** Workspace labels: read by anyone with workspace access, written by owners and editors. */
export function registerLabelRoutes(
  app: FastifyInstance,
  dependencies: { readonly labels: LabelService },
): void {
  app.get("/api/labels", { preHandler: app.authenticate }, async (request) => {
    const items = await dependencies.labels.listLabels(
      requirePrincipal(request),
    );
    return labelListResponseSchema.parse({ items: items.map(serializeLabel) });
  });
  app.post(
    "/api/labels",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(labelCreateRequestSchema, request.body);
      const label = await dependencies.labels.createLabel(
        requirePrincipal(request),
        input.name,
      );
      return reply
        .code(201)
        .send(labelResponseSchema.parse(serializeLabel(label)));
    },
  );
  app.patch(
    "/api/labels/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(labelUpdateRequestSchema, request.body);
      const label = await dependencies.labels.updateLabel(
        requirePrincipal(request),
        id,
        input.expectedVersion,
        input.name,
      );
      return labelResponseSchema.parse(serializeLabel(label));
    },
  );
  app.delete(
    "/api/labels/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const { expectedVersion } = parseRequest(
        labelDeleteQuerySchema,
        request.query,
      );
      const label = await dependencies.labels.deleteLabel(
        requirePrincipal(request),
        id,
        expectedVersion,
      );
      return labelResponseSchema.parse(serializeLabel(label));
    },
  );
}

import type { StorageInventoryService } from "@chronelle/object-model";
import {
  storageInventoryQuerySchema,
  storageInventoryResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export function registerStorageInventoryRoutes(
  app: FastifyInstance,
  dependencies: { readonly storageInventory: StorageInventoryService },
): void {
  app.get(
    "/api/workspace/storage-inventory",
    { preHandler: app.authenticate },
    async (request) => {
      parseRequest(storageInventoryQuerySchema, request.query);
      return storageInventoryResponseSchema.parse(
        await dependencies.storageInventory.get(requirePrincipal(request)),
      );
    },
  );
}

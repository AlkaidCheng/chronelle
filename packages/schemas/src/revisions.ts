import { z } from "zod";

import {
  documentResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
  reminderResponseSchema,
  taskResponseSchema,
} from "./event-planning.js";

const privateFields = { permissionScopeId: true, metadata: true } as const;

export const revisionSnapshotSchema = z.discriminatedUnion("objectType", [
  eventResponseSchema.omit(privateFields),
  taskResponseSchema.omit(privateFields),
  expenseResponseSchema.omit(privateFields),
  reminderResponseSchema.omit(privateFields),
  documentResponseSchema.omit({
    ...privateFields,
    storageProvider: true,
    encryptionMode: true,
  }),
]);

const versionSchema = z.number().int().positive().max(2_147_483_647);
export const revisionListQuerySchema = z
  .object({
    beforeVersion: z.coerce.number().pipe(versionSchema).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const revisionParamsSchema = z.object({
  id: z.uuid(),
  version: z.coerce.number().pipe(versionSchema),
});

export const revisionSummarySchema = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  objectVersion: versionSchema,
  mutationKind: z.enum([
    "baseline",
    "created",
    "updated",
    "permission_scope_updated",
    "deleted",
  ]),
  actorType: z.enum(["user", "assistant", "service_account", "system"]),
  actorId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  snapshotSchemaVersion: z.number().int().positive(),
});
export const revisionListResponseSchema = z.object({
  items: z.array(revisionSummarySchema),
  nextBeforeVersion: versionSchema.nullable(),
});
export const revisionResponseSchema = revisionSummarySchema.extend({
  snapshot: revisionSnapshotSchema,
});

export type RevisionListQuery = z.output<typeof revisionListQuerySchema>;
export type RevisionListQueryInput = z.input<typeof revisionListQuerySchema>;
export type RevisionListResponse = z.output<typeof revisionListResponseSchema>;
export type RevisionResponse = z.output<typeof revisionResponseSchema>;

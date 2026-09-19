import { z } from "zod";

import {
  documentResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
  noteResponseSchema,
  personResponseSchema,
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
  personResponseSchema.omit(privateFields),
  noteResponseSchema.omit(privateFields),
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

export const revisionFieldChangeSchema = z.object({
  field: z.string(),
  label: z.string(),
  valueType: z.enum(["text", "datetime", "boolean", "json", "decimal"]),
  before: z.unknown(),
  after: z.unknown(),
  beforePresent: z.boolean(),
  afterPresent: z.boolean(),
  restorable: z.boolean(),
});

/**
 * A revision as the history list shows it. `changedFields` names up to three
 * content fields that differ from the previous revision, with their values;
 * `changedFieldCount` is the full number, so a row can say how many more.
 */
export const revisionSummarySchema = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  objectVersion: versionSchema,
  mutationKind: z.enum([
    "recovered",
    "restored",
    "baseline",
    "created",
    "updated",
    "permission_scope_updated",
    "deleted",
  ]),
  actorType: z.enum(["user", "assistant", "service_account", "system"]),
  actorId: z.uuid().nullable(),
  actorDisplayName: z.string().nullable().default(null),
  createdAt: z.iso.datetime(),
  snapshotSchemaVersion: z.number().int().positive(),
  sourceRevisionId: z.uuid().nullable().default(null),
  changedFields: z.array(revisionFieldChangeSchema).max(3).default([]),
  changedFieldCount: z.number().int().nonnegative().default(0),
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
export type RevisionSnapshot = z.output<typeof revisionSnapshotSchema>;

export const revisionComparisonQuerySchema = z
  .object({
    fromVersion: z.coerce.number().pipe(versionSchema),
    toVersion: z.coerce.number().pipe(versionSchema),
  })
  .strict();

export const revisionComparisonResponseSchema = z.object({
  objectId: z.uuid(),
  fromVersion: versionSchema,
  toVersion: versionSchema,
  changes: z.array(revisionFieldChangeSchema),
});

export const revisionRestorePreviewSchema = z.object({
  objectId: z.uuid(),
  sourceRevisionId: z.uuid(),
  sourceVersion: versionSchema,
  currentVersion: versionSchema,
  canRestore: z.boolean(),
  changes: z.array(revisionFieldChangeSchema),
  preservedFields: z.array(z.string()),
});

export const revisionRestoreRequestSchema = z
  .object({
    expectedVersion: versionSchema,
  })
  .strict();

export type RevisionComparisonQuery = z.output<
  typeof revisionComparisonQuerySchema
>;
export type RevisionFieldChange = z.output<typeof revisionFieldChangeSchema>;
export type RevisionComparisonResponse = z.output<
  typeof revisionComparisonResponseSchema
>;
export type RevisionRestorePreview = z.output<
  typeof revisionRestorePreviewSchema
>;
export type RevisionRestoreRequest = z.output<
  typeof revisionRestoreRequestSchema
>;

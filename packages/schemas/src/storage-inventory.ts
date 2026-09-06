import { z } from "zod";

const count = z.number().int().nonnegative();

export const storageInventoryQuerySchema = z.object({}).strict();

export const storageInventoryResponseSchema = z.object({
  workspaceId: z.uuid(),
  storageProvider: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  consistency: z.literal("observational"),
  retentionPolicy: z.literal("retain-all"),
  references: z.object({
    canonical: count,
    historicalOnly: count,
    missingCanonical: count,
    missingHistoricalOnly: count,
  }),
  entries: z.object({
    canonical: count,
    historicalOnly: count,
    pendingUpload: count,
    expiredUpload: count,
    unreferenced: count,
    unsupported: count,
  }),
});

export type StorageInventoryResponse = z.infer<
  typeof storageInventoryResponseSchema
>;

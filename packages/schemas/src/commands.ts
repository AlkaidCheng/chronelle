import { z } from "zod";
import {
  eventUpdateRequestSchema,
  taskUpdateRequestSchema,
} from "./event-planning.js";

const idSchema = z.uuid().transform((value) => value.toLowerCase());
const versionSchema = z.number().int().nonnegative().max(2_147_483_647);
const contentOnly = { metadata: z.never().optional() };

export const commandEditSchema = z.discriminatedUnion("objectType", [
  z
    .object({
      objectType: z.literal("event"),
      objectId: idSchema,
      patch: eventUpdateRequestSchema.safeExtend(contentOnly).strict(),
    })
    .strict(),
  z
    .object({
      objectType: z.literal("task"),
      objectId: idSchema,
      patch: taskUpdateRequestSchema.safeExtend(contentOnly).strict(),
    })
    .strict(),
]);

export const commandExecuteRequestSchema = z
  .object({
    operationId: idSchema,
    expectedStackVersion: versionSchema,
    edits: z
      .array(commandEditSchema)
      .min(1)
      .max(10)
      .refine(
        (edits) =>
          new Set(edits.map((edit) => edit.objectId)).size === edits.length,
        "Each object can appear only once in a command.",
      ),
  })
  .strict();

export const commandTransitionRequestSchema = z
  .object({
    operationId: idSchema,
    commandId: idSchema,
    expectedStackVersion: versionSchema,
  })
  .strict();

const headSchema = z.object({
  commandId: idSchema,
  available: z.boolean(),
});

export const commandStateResponseSchema = z.object({
  version: versionSchema,
  undo: headSchema.nullable(),
  redo: headSchema.nullable(),
});

export const commandReceiptSchema = z.object({
  operationId: idSchema,
  commandId: idSchema,
  direction: z.enum(["execute", "undo", "redo"]),
  stackVersion: versionSchema,
  objects: z
    .array(z.object({ id: idSchema, version: versionSchema.min(1) }))
    .min(1)
    .max(10),
});

export type CommandEdit = z.output<typeof commandEditSchema>;
export type CommandExecuteRequest = z.output<
  typeof commandExecuteRequestSchema
>;
export type CommandExecutePayload = z.input<typeof commandExecuteRequestSchema>;
export type CommandTransitionRequest = z.output<
  typeof commandTransitionRequestSchema
>;
export type CommandStateResponse = z.output<typeof commandStateResponseSchema>;
export type CommandReceipt = z.output<typeof commandReceiptSchema>;

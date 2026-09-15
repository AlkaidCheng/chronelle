import { z } from "zod";

import {
  eventCreateRequestSchema,
  expenseCreateRequestSchema,
  personCreateRequestSchema,
  reminderCreateRequestSchema,
  taskCreateRequestSchema,
  eventPlanningResourceResponseSchema,
} from "./event-planning.js";

export const eventContextCreateRequestSchema = z
  .object({
    commandId: z.uuid(),
    relationMetadata: z.record(z.string(), z.unknown()).optional(),
    resource: z.discriminatedUnion("objectType", [
      eventCreateRequestSchema
        .omit({ permissionScopeId: true })
        .extend({ objectType: z.literal("event") })
        .strict(),
      taskCreateRequestSchema
        .omit({ permissionScopeId: true })
        .extend({ objectType: z.literal("task") })
        .strict(),
      expenseCreateRequestSchema
        .omit({ permissionScopeId: true })
        .extend({ objectType: z.literal("expense") })
        .strict(),
      reminderCreateRequestSchema
        .omit({ permissionScopeId: true })
        .extend({ objectType: z.literal("reminder") }),
      personCreateRequestSchema
        .omit({ permissionScopeId: true })
        .extend({ objectType: z.literal("person") })
        .strict(),
    ]),
  })
  .strict();

export const eventContextCreateResponseSchema = z.object({
  resource: eventPlanningResourceResponseSchema,
  relationId: z.uuid(),
});

export type EventContextCreateRequest = z.output<
  typeof eventContextCreateRequestSchema
>;
export type EventContextCreatePayload = z.input<
  typeof eventContextCreateRequestSchema
>;
export type EventContextCreateResponse = z.output<
  typeof eventContextCreateResponseSchema
>;

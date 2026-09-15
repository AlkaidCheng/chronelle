import { z } from "zod";

import { personResponseSchema } from "./event-planning.js";

/**
 * The workspace's people: every live Person the caller may view, in name
 * order, the first `limit` of them; `query` matches the name.
 */
export const personListQuerySchema = z.object({
  query: z.string().trim().max(240).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const personListResponseSchema = z.object({
  items: z.array(personResponseSchema),
});

export type PersonListQuery = z.infer<typeof personListQuerySchema>;
export type PersonListQueryInput = z.input<typeof personListQuerySchema>;
export type PersonListResponse = z.infer<typeof personListResponseSchema>;

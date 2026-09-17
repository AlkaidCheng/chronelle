import { z } from "zod";

import { roleSchema } from "./sharing.js";

const idSchema = z.uuid();
const dateTimeSchema = z.iso.datetime();

/**
 * A member of the current workspace: their account, their role, whether
 * the workspace is their personal one, and the caller's connection to
 * them when they are friends.
 */
export const workspaceMemberSchema = z.object({
  userId: idSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  role: roleSchema,
  personal: z.boolean(),
  friendId: idSchema.nullable(),
  joinedAt: dateTimeSchema,
});

export const workspaceMemberListResponseSchema = z.object({
  items: z.array(workspaceMemberSchema),
});

/** Adds a friend as a member, or changes the role of one who already is. */
export const workspaceMemberAddRequestSchema = z.object({
  friendId: idSchema,
  role: z.enum(["editor", "viewer"]),
});

export const workspaceMemberParamsSchema = z.object({ userId: idSchema });

export const workspaceMemberRemovalResponseSchema = z.object({
  userId: idSchema,
  removed: z.literal(true),
});

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceMemberListResponse = z.infer<
  typeof workspaceMemberListResponseSchema
>;
export type WorkspaceMemberAddRequest = z.infer<
  typeof workspaceMemberAddRequestSchema
>;
export type WorkspaceMemberRemovalResponse = z.infer<
  typeof workspaceMemberRemovalResponseSchema
>;

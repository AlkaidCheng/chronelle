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
  role: roleSchema,
});

/** Changes a member's role; the space keeps at least one Owner. */
export const workspaceMemberRoleRequestSchema = z.object({
  role: roleSchema,
});

export const workspaceMemberParamsSchema = z.object({ userId: idSchema });

export const workspaceMemberRemovalResponseSchema = z.object({
  userId: idSchema,
  removed: z.literal(true),
});

/** The caller left the current space. */
export const workspaceLeaveResponseSchema = z.object({
  userId: idSchema,
  left: z.literal(true),
});

const workspaceNameSchema = z.string().trim().min(1).max(80);

/** A new shared space, with the caller as its Owner. */
export const workspaceCreateRequestSchema = z.object({
  displayName: workspaceNameSchema,
});

/** A new name for the current space. */
export const workspaceUpdateRequestSchema = z.object({
  displayName: workspaceNameSchema,
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
export type WorkspaceMemberRoleRequest = z.infer<
  typeof workspaceMemberRoleRequestSchema
>;
export type WorkspaceLeaveResponse = z.infer<
  typeof workspaceLeaveResponseSchema
>;
export type WorkspaceCreateRequest = z.infer<
  typeof workspaceCreateRequestSchema
>;
export type WorkspaceUpdateRequest = z.infer<
  typeof workspaceUpdateRequestSchema
>;

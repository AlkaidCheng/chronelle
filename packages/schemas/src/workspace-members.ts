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

/**
 * Why the current space cannot be deleted, in the order it is decided: a
 * Personal space is never deleted, only an Owner deletes a space, and only
 * while it holds no live record.
 */
export const workspaceDeletionRefusalSchema = z.enum([
  "personal",
  "not_owner",
  "holds_records",
]);

/**
 * Whether the caller may delete the current space, and what it holds: its
 * live records, the records in its Trash (which go with it), and its
 * members. A record is live when neither it nor its permission scope is in
 * Trash.
 */
export const workspaceDeletionResponseSchema = z
  .object({
    deletable: z.boolean(),
    reason: workspaceDeletionRefusalSchema.nullable(),
    liveRecords: z.number().int().nonnegative(),
    trashRecords: z.number().int().nonnegative(),
    memberCount: z.number().int().nonnegative(),
  })
  .refine((deletion) => deletion.deletable === (deletion.reason === null), {
    message: "A space is deletable exactly when nothing refuses it.",
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
export type WorkspaceDeletionRefusal = z.infer<
  typeof workspaceDeletionRefusalSchema
>;
export type WorkspaceDeletionResponse = z.infer<
  typeof workspaceDeletionResponseSchema
>;

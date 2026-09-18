import { z } from "zod";

const idSchema = z.uuid();
const dateTimeSchema = z.iso.datetime();
const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());

/**
 * Friends belong to the account, not to a workspace. A request names an
 * address; when it has an account the request waits on that account's
 * Friends page, otherwise an invitation with a sign-up link waits for the
 * address. Either may come from a person card of the current workspace,
 * which is linked to the friend once they accept.
 */
export const friendInvitationRequestSchema = z.object({
  email: emailSchema,
  message: z.string().trim().min(1).max(500).optional(),
  personId: idSchema.optional(),
});

/** An accepted connection, as one side sees it. */
export const friendSchema = z.object({
  id: idSchema,
  userId: idSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  since: dateTimeSchema,
});

/** A request waiting for the caller's answer. */
export const friendRequestSchema = z.object({
  id: idSchema,
  requester: z.object({
    userId: idSchema,
    displayName: z.string(),
    email: z.string().nullable(),
  }),
  message: z.string().nullable(),
  createdAt: dateTimeSchema,
});

/**
 * What the caller sent and is still waiting: a request to an account or an
 * invitation to an address, told apart only by `kind`; `expiresAt` is set
 * for an invitation.
 */
export const sentInvitationSchema = z.object({
  id: idSchema,
  kind: z.enum(["connection", "invitation"]),
  email: z.string(),
  message: z.string().nullable(),
  personId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  createdAt: dateTimeSchema,
  expiresAt: dateTimeSchema.nullable(),
});

/**
 * A request to an account found by search or by its code; the same request
 * an invitation to a known address makes, so it waits on the other
 * account's Friends page.
 */
export const friendRequestRequestSchema = z.object({
  userId: idSchema,
  message: z.string().trim().min(1).max(500).optional(),
  personId: idSchema.optional(),
});

/** How the caller and another account stand. */
export const friendRelationSchema = z.enum([
  "none",
  "friend",
  "requested",
  "incoming",
]);

/** An account as Find people and the code page show it. */
export const userSummarySchema = z.object({
  id: idSchema,
  displayName: z.string(),
  username: z.string(),
  relation: friendRelationSchema,
});

export const userSearchResponseSchema = z.object({
  items: z.array(userSummarySchema),
});

export const userSearchQuerySchema = z.object({
  q: z.string().max(254).default(""),
});

export const usernameParamsSchema = z.object({
  username: z.string().min(1).max(30),
});

export const friendsResponseSchema = z.object({
  friends: z.array(friendSchema),
  incoming: z.array(friendRequestSchema),
  sent: z.array(sentInvitationSchema),
});

export const friendItemParamsSchema = z.object({ id: idSchema });

/** The outcome of ending a request, an invitation, or a connection. */
export const friendItemStateResponseSchema = z.object({
  id: idSchema,
  status: z.enum(["declined", "withdrawn", "removed"]),
});

export type FriendInvitationRequest = z.infer<
  typeof friendInvitationRequestSchema
>;
export type FriendInvitationPayload = z.input<
  typeof friendInvitationRequestSchema
>;
export type Friend = z.infer<typeof friendSchema>;
export type FriendRequestRequest = z.infer<typeof friendRequestRequestSchema>;
export type FriendRelation = z.infer<typeof friendRelationSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UserSearchResponse = z.infer<typeof userSearchResponseSchema>;
export type FriendRequest = z.infer<typeof friendRequestSchema>;
export type SentInvitation = z.infer<typeof sentInvitationSchema>;
export type FriendsResponse = z.infer<typeof friendsResponseSchema>;
export type FriendItemStateResponse = z.infer<
  typeof friendItemStateResponseSchema
>;

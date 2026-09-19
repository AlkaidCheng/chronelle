import { z } from "zod";

const idSchema = z.uuid();
const dateTimeSchema = z.iso.datetime();
const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());

/** How an invitation reaches someone: emailed to an address, or as a link the sender hands on. */
export const invitationChannelSchema = z.enum(["email", "link"]);

/**
 * Friends belong to the account, not to a workspace. An invitation names
 * an address or asks for a link: an address that has an account makes a
 * request that waits on that account's Friends page; otherwise an
 * invitation link waits, emailed to the address or handed on by the
 * sender (an address is required to send by email). Either may come from
 * a person card of the current workspace, which is linked to the friend
 * once they accept.
 */
export const friendInvitationRequestSchema = z
  .object({
    channel: invitationChannelSchema.default("email"),
    email: emailSchema.optional(),
    message: z.string().trim().min(1).max(500).optional(),
    personId: idSchema.optional(),
  })
  .refine((input) => input.channel === "link" || input.email !== undefined, {
    message: "Give an email to send the invitation to.",
    path: ["email"],
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
 * What the caller sent and is still waiting: a request to an account
 * (`kind` connection, with the account's address) or an invitation (`kind`
 * invitation, with its channel, the link to copy, when it expires, and the
 * address when it has one).
 */
export const sentInvitationSchema = z.object({
  id: idSchema,
  kind: z.enum(["connection", "invitation"]),
  email: z.string().nullable(),
  channel: invitationChannelSchema.nullable(),
  inviteUrl: z.string().nullable(),
  message: z.string().nullable(),
  personId: idSchema.nullable(),
  workspaceId: idSchema.nullable(),
  createdAt: dateTimeSchema,
  expiresAt: dateTimeSchema.nullable(),
});

const queuedRecordSchema = z.object({
  resourceId: idSchema,
  displayName: z.string(),
  role: z.enum(["owner", "editor", "viewer"]),
});

/** An invitation as its link shows it, to anyone who has the link. */
export const invitationPeekResponseSchema = z.object({
  requester: z.object({ displayName: z.string(), username: z.string() }),
  message: z.string().nullable(),
  queued: z.array(queuedRecordSchema),
  expiresAt: dateTimeSchema,
  status: z.enum(["open", "used", "withdrawn", "expired"]),
});

export const invitationTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u),
});

/** What accepting an invitation changed: the friendship, and the queued shares applied or already held. */
export const invitationAcceptResponseSchema = z.object({
  friendship: z.enum(["made", "existing"]),
  shared: z.array(queuedRecordSchema),
  alreadyHad: z.array(queuedRecordSchema),
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
export type InvitationChannel = z.infer<typeof invitationChannelSchema>;
export type SentInvitation = z.infer<typeof sentInvitationSchema>;
export type InvitationPeekResponse = z.infer<
  typeof invitationPeekResponseSchema
>;
export type InvitationAcceptResponse = z.infer<
  typeof invitationAcceptResponseSchema
>;
export type QueuedRecord = z.infer<typeof queuedRecordSchema>;
export type FriendsResponse = z.infer<typeof friendsResponseSchema>;
export type FriendItemStateResponse = z.infer<
  typeof friendItemStateResponseSchema
>;

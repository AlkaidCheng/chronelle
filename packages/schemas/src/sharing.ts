import { z } from "zod";

const idSchema = z.uuid();
const dateTimeSchema = z.iso.datetime();

export const roleSchema = z.enum(["owner", "editor", "viewer"]);
export const authorizationActionSchema = z.enum([
  "view",
  "comment",
  "edit",
  "share",
  "delete",
  "recover",
]);

/**
 * A share names its grantee as an account email, as a Person of the
 * workspace (whose linked account, else the one account with the person's
 * email, receives the role), or as a friend of the acting account by the
 * connection's id.
 */
export const shareCreateRequestSchema = z
  .object({
    resourceId: idSchema,
    principalEmail: z
      .email()
      .transform((email) => email.toLowerCase())
      .optional(),
    personId: idSchema.optional(),
    friendId: idSchema.optional(),
    role: roleSchema,
  })
  .refine(
    (value) =>
      [value.principalEmail, value.personId, value.friendId].filter(
        (grantee) => grantee !== undefined,
      ).length === 1,
    "Name exactly one of principalEmail, personId, and friendId.",
  );

/**
 * A share waiting on a request or invitation the acting account sent to
 * the person: granted to them when they accept. `person` is the card it
 * was ticked from; `email` the address it waits on.
 */
export const pendingShareSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  resourceId: idSchema,
  role: roleSchema,
  status: z.literal("pending"),
  kind: z.enum(["connection", "invitation"]),
  itemId: idSchema,
  person: z.object({ id: idSchema, displayName: z.string() }).nullable(),
  email: z.string().nullable(),
  grantedBy: idSchema,
  createdAt: dateTimeSchema,
});

/**
 * Queues a share for a Person who has no account here yet: an invitation
 * is sent to the person's email when none waits, and the share follows
 * when it is accepted.
 */
export const pendingShareCreateRequestSchema = z.object({
  resourceId: idSchema,
  personId: idSchema,
  role: roleSchema,
});

export const pendingShareRevocationResponseSchema = z.object({
  id: idSchema,
  revokedAt: dateTimeSchema,
});

export const shareResponseSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  resourceId: idSchema,
  principal: z.object({
    id: idSchema,
    displayName: z.string(),
    email: z.email().nullable(),
  }),
  role: roleSchema,
  grantedBy: idSchema,
  createdAt: dateTimeSchema,
  expiresAt: dateTimeSchema.nullable(),
});

export const shareListResponseSchema = z.object({
  items: z.array(shareResponseSchema),
  pending: z.array(pendingShareSchema).default([]),
});

export const shareRevocationResponseSchema = z.object({
  id: idSchema,
  revokedAt: dateTimeSchema,
});

const accountSummarySchema = z.object({
  id: idSchema,
  displayName: z.string(),
});

/**
 * Where the caller's access to a record comes from: the workspace they belong
 * to, a grant on the record itself, or a grant on the Event whose scope the
 * record inherits. Anything the caller can view has one of the three.
 */
export const accessSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("own") }),
  z.object({
    kind: z.literal("direct"),
    grantedBy: accountSummarySchema,
    role: roleSchema,
  }),
  z.object({
    kind: z.literal("inherited"),
    through: accountSummarySchema,
    grantedBy: accountSummarySchema,
    role: roleSchema,
  }),
]);

export const objectAccessResponseSchema = z.object({
  resourceId: idSchema,
  actions: z.array(authorizationActionSchema),
  source: accessSourceSchema,
});

export const permissionScopeUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  permissionScopeId: idSchema,
});

export type ShareCreateRequest = z.infer<typeof shareCreateRequestSchema>;
export type ShareCreatePayload = z.input<typeof shareCreateRequestSchema>;
export type ShareResponse = z.infer<typeof shareResponseSchema>;
export type ShareListResponse = z.infer<typeof shareListResponseSchema>;
export type ShareRevocationResponse = z.infer<
  typeof shareRevocationResponseSchema
>;
export type PendingShare = z.infer<typeof pendingShareSchema>;
export type PendingShareCreateRequest = z.infer<
  typeof pendingShareCreateRequestSchema
>;
export type PendingShareRevocationResponse = z.infer<
  typeof pendingShareRevocationResponseSchema
>;
export type AccessSource = z.infer<typeof accessSourceSchema>;
export type ObjectAccessResponse = z.infer<typeof objectAccessResponseSchema>;
export type PermissionScopeUpdateRequest = z.infer<
  typeof permissionScopeUpdateRequestSchema
>;
export type PermissionScopeUpdatePayload = z.input<
  typeof permissionScopeUpdateRequestSchema
>;

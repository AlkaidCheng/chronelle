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
 * A share names its grantee as an account email or as a Person of the
 * workspace, whose linked account (else the one account with the person's
 * email) receives the role.
 */
export const shareCreateRequestSchema = z
  .object({
    resourceId: idSchema,
    principalEmail: z
      .email()
      .transform((email) => email.toLowerCase())
      .optional(),
    personId: idSchema.optional(),
    role: roleSchema,
  })
  .refine(
    (value) =>
      (value.principalEmail === undefined) !== (value.personId === undefined),
    "Name exactly one of principalEmail and personId.",
  );

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
});

export const shareRevocationResponseSchema = z.object({
  id: idSchema,
  revokedAt: dateTimeSchema,
});

export const objectAccessResponseSchema = z.object({
  resourceId: idSchema,
  actions: z.array(authorizationActionSchema),
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
export type ObjectAccessResponse = z.infer<typeof objectAccessResponseSchema>;
export type PermissionScopeUpdateRequest = z.infer<
  typeof permissionScopeUpdateRequestSchema
>;
export type PermissionScopeUpdatePayload = z.input<
  typeof permissionScopeUpdateRequestSchema
>;

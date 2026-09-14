import { z } from "zod";

export const developmentSignInRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.email().transform((email) => email.toLowerCase()),
});

const userSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.email().nullable(),
});

export const workspaceSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

export const developmentSignInResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresAt: z.iso.datetime(),
  user: userSchema,
  workspace: workspaceSummarySchema,
});

export const sessionResponseSchema = z.object({
  principal: z.object({
    type: z.literal("user"),
    userId: z.uuid(),
    workspaceId: z.uuid(),
  }),
  user: userSchema,
  workspace: workspaceSummarySchema,
  availableWorkspaces: z.array(workspaceSummarySchema),
});

/** The outcome of a sign-out: how many live sessions ended. */
export const sessionRevocationResponseSchema = z.object({
  revoked: z.number().int().nonnegative(),
});

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type DevelopmentSignInRequest = z.infer<
  typeof developmentSignInRequestSchema
>;
export type DevelopmentSignInResponse = z.infer<
  typeof developmentSignInResponseSchema
>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type SessionRevocationResponse = z.infer<
  typeof sessionRevocationResponseSchema
>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

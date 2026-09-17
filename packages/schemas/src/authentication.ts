import { z } from "zod";

export const developmentSignInRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.email().transform((email) => email.toLowerCase()),
});

const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());
const passwordSchema = z.string().min(10).max(256);
const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

/**
 * A BCP 47 language tag as the application uses it ("en", "zh-Hans",
 * "zh-Hant"). The shape is checked, not the value, so a language added later
 * is accepted by every backend without a change here.
 */
export const localeTagSchema = z
  .string()
  .trim()
  .max(35)
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const signUpRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  locale: localeTagSchema.optional(),
});

/** The language kept on the account; null clears it. */
export const localePreferenceRequestSchema = z.object({
  locale: localeTagSchema.nullable(),
});

export const emailRequestSchema = z.object({
  email: emailSchema,
});

export const verifyEmailRequestSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});

export const passwordSignInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const passwordResetConfirmRequestSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
  password: passwordSchema,
});

/** A request that was accepted without revealing whether it applied to an account. */
export const acceptedResponseSchema = z.object({
  accepted: z.literal(true),
});

const userSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.email().nullable(),
  locale: z.string().nullable().default(null),
});

/** The account as the session and account routes return it. */
export const userResponseSchema = userSchema;

export const workspaceSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

/** A sign-in of any kind: the bearer credential and the account behind it. */
export const signInResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresAt: z.iso.datetime(),
  user: userSchema,
  workspace: workspaceSummarySchema,
});

export const developmentSignInResponseSchema = signInResponseSchema;

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
export type SignInResponse = z.infer<typeof signInResponseSchema>;
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
export type EmailRequest = z.infer<typeof emailRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type PasswordSignInRequest = z.infer<typeof passwordSignInRequestSchema>;
export type PasswordResetConfirmRequest = z.infer<
  typeof passwordResetConfirmRequestSchema
>;
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type SessionRevocationResponse = z.infer<
  typeof sessionRevocationResponseSchema
>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type LocalePreferenceRequest = z.infer<
  typeof localePreferenceRequestSchema
>;
export type UserResponse = z.infer<typeof userResponseSchema>;

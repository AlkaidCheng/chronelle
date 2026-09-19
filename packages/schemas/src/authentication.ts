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

/**
 * The handle every account carries, whatever it signed up with: 3 to 30
 * letters, digits, hyphens or underscores, starting with a letter; unique
 * without regard to case.
 */
export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{2,29}$/u);

export const signUpRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  /** The username chosen at sign-up. */
  username: usernameSchema,
  /** The name; the Welcome step asks for it after the email is confirmed when sign-up brings none. */
  displayName: z.string().trim().min(1).max(120).optional(),
  locale: localeTagSchema.optional(),
  /** The token of the friend invitation the sign-up link carried. */
  invitationToken: z.string().trim().min(1).max(256).optional(),
});

/**
 * An IANA time zone name ("Asia/Shanghai", "America/New_York", "UTC"). The
 * shape is checked here and by the database; whether the zone exists is
 * checked by the API against the runtime's zone list.
 */
export const timeZoneNameSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/);

/** The clock the account shows: 12-hour or 24-hour. */
export const hourCycleSchema = z.enum(["h12", "h23"]);

/** The first day of the account's week: 1 for Monday, 7 for Sunday. */
export const weekStartSchema = z.union([z.literal(1), z.literal(7)]);

const collectionKeySchema = z.string().min(1).max(40);

/**
 * How the rail lists the workspace collections: `order` names collection
 * keys first to last and `hidden` the keys left out, each optional. A key
 * the app does not know is kept and ignored, so a collection that ships
 * later appends in its default place.
 */
export const railPreferenceSchema = z.object({
  order: z.array(collectionKeySchema).max(50).optional(),
  hidden: z.array(collectionKeySchema).max(50).optional(),
});

const tabKeySchema = z.string().min(1).max(40);

/**
 * How an event's tab strip lists that event's pages and views for the
 * account: `order` names view keys first to last, `hidden` the view keys
 * and page ids left out of the strip but kept, and `removed` the view keys
 * taken off the event until added again, each optional. A key the app
 * does not know is kept and ignored.
 */
export const eventTabsPreferenceSchema = z.object({
  order: z.array(tabKeySchema).max(40).optional(),
  hidden: z.array(tabKeySchema).max(40).optional(),
  removed: z.array(tabKeySchema).max(40).optional(),
});

/** Tab preferences keyed by event id. */
export const eventTabsSchema = z.record(z.uuid(), eventTabsPreferenceSchema);

/**
 * The preferences kept on the account. Each key is optional; a key that is
 * present replaces the stored value, and null clears it so the device or the
 * language decides again (the rail returns to its default order). An empty
 * object changes nothing. `eventTabs` merges one event at a time: an
 * object replaces that event's tabs and null drops them, while events not
 * named keep theirs.
 */
export const preferencesRequestSchema = z.object({
  locale: localeTagSchema.nullable().optional(),
  timeZone: timeZoneNameSchema.nullable().optional(),
  hourCycle: hourCycleSchema.nullable().optional(),
  weekStart: weekStartSchema.nullable().optional(),
  rail: railPreferenceSchema.nullable().optional(),
  eventTabs: z
    .record(z.uuid(), eventTabsPreferenceSchema.nullable())
    .optional(),
});

export const emailRequestSchema = z.object({
  email: emailSchema,
});

export const verifyEmailRequestSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});

/**
 * A sign-in by the email of the account or by its username: a login with
 * an "@" is an address and is normalized as one.
 */
export const passwordSignInRequestSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .transform((login) => (login.includes("@") ? login.toLowerCase() : login)),
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

/**
 * The account fields the account route changes: the name, who can find
 * the account (by name and by email; finding it by username is always
 * on), and the completion of the Welcome step. A key that is present
 * replaces the stored value. The username is not among them: it is chosen
 * once, at sign-up.
 */
export const accountUpdateRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    findByName: z.boolean().optional(),
    findByEmail: z.boolean().optional(),
    onboarded: z.literal(true).optional(),
  })
  .strict();

/** Whether a username is free, asked before signing up. */
export const usernameAvailabilityQuerySchema = z.object({
  username: z.string().min(1).max(30),
});

export const usernameAvailabilityResponseSchema = z.object({
  available: z.boolean(),
});

const userSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.email().nullable(),
  username: usernameSchema,
  findByName: z.boolean().default(true),
  findByEmail: z.boolean().default(true),
  /** When the Welcome step was completed; null while it is due. */
  onboardedAt: z.string().nullable().default(null),
  locale: z.string().nullable().default(null),
  timeZone: z.string().nullable().default(null),
  hourCycle: hourCycleSchema.nullable().default(null),
  weekStart: weekStartSchema.nullable().default(null),
  rail: railPreferenceSchema.default({}),
  eventTabs: eventTabsSchema.default({}),
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
export type PreferencesRequest = z.infer<typeof preferencesRequestSchema>;
export type AccountUpdateRequest = z.infer<typeof accountUpdateRequestSchema>;
export type UsernameAvailabilityResponse = z.infer<
  typeof usernameAvailabilityResponseSchema
>;
export type HourCycle = z.infer<typeof hourCycleSchema>;
export type WeekStart = z.infer<typeof weekStartSchema>;
export type RailPreference = z.infer<typeof railPreferenceSchema>;
export type EventTabsPreference = z.infer<typeof eventTabsPreferenceSchema>;
export type EventTabs = z.infer<typeof eventTabsSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;

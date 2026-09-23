import {
  timeZoneNameSchema,
  type PreferencesRequest,
  type UserResponse,
} from "@chronelle/schemas";

export type AccountPreferences = Pick<
  UserResponse,
  "locale" | "timeZone" | "hourCycle" | "weekStart"
>;

export class PreferencesValidationError extends Error {
  constructor() {
    super("Invalid time zone name.");
    this.name = "PreferencesValidationError";
  }
}

export function preferencesFromUser(user: UserResponse): AccountPreferences {
  return {
    locale: user.locale,
    timeZone: user.timeZone,
    hourCycle: user.hourCycle,
    weekStart: user.weekStart,
  };
}

export function preferencesUpdate(
  original: AccountPreferences,
  draft: AccountPreferences,
): PreferencesRequest {
  const timeZone = draft.timeZone?.trim() || null;
  if (
    timeZone !== null &&
    timeZone !== original.timeZone &&
    !timeZoneNameSchema.safeParse(timeZone).success
  )
    throw new PreferencesValidationError();
  return {
    ...(draft.locale !== original.locale && { locale: draft.locale }),
    ...(timeZone !== original.timeZone && { timeZone }),
    ...(draft.hourCycle !== original.hourCycle && {
      hourCycle: draft.hourCycle,
    }),
    ...(draft.weekStart !== original.weekStart && {
      weekStart: draft.weekStart,
    }),
  };
}

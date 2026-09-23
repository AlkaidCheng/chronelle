import {
  timeZoneNameSchema,
  type PreferencesRequest,
  type UserResponse,
} from "@chronelle/schemas";

export type AccountPreferences = Pick<
  UserResponse,
  "locale" | "timeZone" | "hourCycle" | "weekStart"
>;

export type PreferencesIssue = "time-zone-format" | "time-zone-unknown";

export class PreferencesValidationError extends Error {
  constructor(readonly issue: PreferencesIssue) {
    super(issue);
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
  if (timeZone !== null && timeZone !== original.timeZone) {
    if (!timeZoneNameSchema.safeParse(timeZone).success) {
      throw new PreferencesValidationError("time-zone-format");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
    } catch {
      throw new PreferencesValidationError("time-zone-unknown");
    }
  }
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

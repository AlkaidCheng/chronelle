import { activeLocale } from "./active-locale";
import { languageWeekStart } from "./locales";

/** The clock an account shows: 12-hour or 24-hour. */
export type HourCycle = "h12" | "h23";

/** The first day of an account's week: 1 for Monday, 7 for Sunday. */
export type WeekStart = 1 | 7;

/**
 * How an account wants dates and times shown, as the account keeps them:
 * a zone or null for the device's, a clock or null for the language's, a
 * first weekday or null for the language's.
 */
export interface TimePreferences {
  readonly timeZone: string | null;
  readonly hourCycle: HourCycle | null;
  readonly weekStart: WeekStart | null;
}

export const defaultTimePreferences: TimePreferences = {
  timeZone: null,
  hourCycle: null,
  weekStart: null,
};

/**
 * The preferences the client is rendering with, for the helpers that place
 * and word dates outside React. `DisplayPreferencesProvider` sets them from
 * the session; without one (the sign-in screens, unit tests, the sandbox
 * build) they are the defaults, which follow the device and the language.
 */
let active: TimePreferences = defaultTimePreferences;

export function activeTimePreferences(): TimePreferences {
  return active;
}

export function setActiveTimePreferences(next: TimePreferences): void {
  if (
    active.timeZone === next.timeZone &&
    active.hourCycle === next.hourCycle &&
    active.weekStart === next.weekStart
  )
    return;
  active = next;
}

/** The zone instants are shown in; undefined leaves Intl on the device's. */
export function activeTimeZone(): string | undefined {
  return active.timeZone ?? undefined;
}

/** The first day of the week the views use: the choice, else the language's. */
export function activeWeekStart(locale: string = activeLocale()): WeekStart {
  return active.weekStart ?? languageWeekStart(locale);
}

/**
 * The Intl options that place an instant on the account's clock: its zone
 * and its hour cycle, each left to Intl when unchosen. Calendar days (a
 * local-midnight Date or a YYYY-MM-DD) never take these.
 */
export function instantOptions(
  preferences: TimePreferences = active,
): Pick<Intl.DateTimeFormatOptions, "timeZone" | "hourCycle"> {
  return {
    ...(preferences.timeZone === null
      ? {}
      : { timeZone: preferences.timeZone }),
    ...(preferences.hourCycle === null
      ? {}
      : { hourCycle: preferences.hourCycle }),
  };
}

/** The zone of the device, as Intl resolves it. */
export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The zone times are shown in, by name: the account's, else the device's. */
export function shownTimeZone(): string {
  return active.timeZone ?? deviceTimeZone();
}

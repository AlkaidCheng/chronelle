"use client";

import type { UserResponse } from "@chronelle/schemas";
import { useLocale } from "next-intl";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";

import {
  defaultTimePreferences,
  type HourCycle,
  instantOptions,
  setActiveTimePreferences,
  type TimePreferences,
  type WeekStart,
} from "../i18n/active-preferences";
import { defaultLocale, isLocale, languageWeekStart } from "../i18n/locales";

/**
 * How the signed-in account wants dates and times shown, resolved for the
 * components that format them: the locale the provider renders with, the
 * account's zone, clock, and week start (null when unchosen), the Intl
 * options an instant takes, and the day the week starts on.
 */
export interface DisplayPreferences extends TimePreferences {
  readonly locale: string;
  /** The zone and clock to give Intl for an instant; absent keys follow the device and the language. */
  readonly instant: Pick<Intl.DateTimeFormatOptions, "timeZone" | "hourCycle">;
  /** The first day of the week the views use: the choice, else the language's. */
  readonly firstDay: WeekStart;
}

const DisplayPreferencesContext = createContext<TimePreferences | null>(null);

/** The account's time preferences from the session's user; the defaults when it carries none. */
export function timePreferencesOf(
  user: Pick<UserResponse, "timeZone" | "hourCycle" | "weekStart"> | undefined,
): TimePreferences {
  if (user === undefined) return defaultTimePreferences;
  return {
    timeZone: user.timeZone,
    hourCycle: user.hourCycle,
    weekStart: user.weekStart,
  };
}

/**
 * Publishes the account's time preferences to the tree below and to the
 * helpers outside React. In the browser it sets the helpers' values during
 * render as well, so the components of the same pass already place their
 * days in the right zone; the sign-in screens render without one and keep
 * the defaults, which follow the device and the language.
 */
export function DisplayPreferencesProvider({
  children,
  preferences,
}: {
  readonly children: ReactNode;
  readonly preferences: TimePreferences;
}) {
  const value = useMemo<TimePreferences>(
    () => ({
      timeZone: preferences.timeZone,
      hourCycle: preferences.hourCycle,
      weekStart: preferences.weekStart,
    }),
    [preferences.timeZone, preferences.hourCycle, preferences.weekStart],
  );
  if (typeof window !== "undefined") setActiveTimePreferences(value);
  useLayoutEffect(() => {
    setActiveTimePreferences(value);
    return () => setActiveTimePreferences(defaultTimePreferences);
  }, [value]);
  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences(): DisplayPreferences {
  const provided = useContext(DisplayPreferencesContext);
  const locale = useLocale();
  return useMemo(() => {
    const preferences = provided ?? defaultTimePreferences;
    const tag = isLocale(locale) ? locale : defaultLocale;
    return {
      ...preferences,
      locale: tag,
      instant: instantOptions(preferences),
      firstDay: preferences.weekStart ?? languageWeekStart(tag),
    };
  }, [provided, locale]);
}

export type { HourCycle, WeekStart };

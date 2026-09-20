import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../messages/en.json";
import { setActiveLocale } from "../i18n/active-locale";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import {
  compareNames,
  formatDatePart,
  formatDateTime,
  formatMoment,
  formatTime,
} from "../lib/format";

afterEach(() => {
  setActiveTimePreferences(defaultTimePreferences);
  setActiveLocale("en", en);
  vi.restoreAllMocks();
});

describe("reusable formatters", () => {
  it("reuses a configured date formatter across a large set of rows", () => {
    setActiveTimePreferences({
      timeZone: "Asia/Tokyo",
      hourCycle: "h23",
      weekStart: null,
    });
    const NativeFormat = Intl.DateTimeFormat;
    const construct = vi
      .spyOn(Intl, "DateTimeFormat")
      // biome-ignore lint/complexity/useArrowFunction: The mock must be constructible.
      .mockImplementation(function (locale, options) {
        return new NativeFormat(locale, options);
      });
    for (let index = 0; index < 1_000; index++)
      formatDateTime(
        new Date(Date.UTC(2030, 0, 1, 0, index)).toISOString(),
        "ja-JP",
      );
    expect(construct).toHaveBeenCalledTimes(1);
  });

  it.each(["en-US", "zh-Hans", "zh-Hant"])(
    "keeps %s output across clock and timezone changes",
    (locale) => {
      const value = "2030-03-10T10:30:00Z";
      for (const timeZone of ["America/Los_Angeles", "Asia/Shanghai", "UTC"]) {
        for (const hourCycle of ["h12", "h23"] as const) {
          setActiveTimePreferences({ timeZone, hourCycle, weekStart: null });
          const options = { timeZone, hourCycle };
          const date = new Date(value);
          expect(formatDateTime(value, locale)).toBe(
            new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
              ...options,
            }).format(date),
          );
          expect(formatTime(value, locale)).toBe(
            new Intl.DateTimeFormat(locale, {
              timeStyle: "short",
              ...options,
            }).format(date),
          );
          for (const part of ["month", "day"] as const)
            expect(formatDatePart(value, part, locale)).toBe(
              new Intl.DateTimeFormat(locale, {
                ...(part === "month"
                  ? { month: "short" as const }
                  : { day: "2-digit" as const }),
                ...options,
              }).format(date),
            );
          expect(
            formatMoment(value, locale, new Date("2031-06-01T00:00:00Z")),
          ).toBe(
            new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              ...options,
            }).format(date),
          );
        }
      }
    },
  );

  it("resolves device-default formatting on every call", () => {
    const NativeFormat = Intl.DateTimeFormat;
    const construct = vi
      .spyOn(Intl, "DateTimeFormat")
      // biome-ignore lint/complexity/useArrowFunction: The mock must be constructible.
      .mockImplementation(function (locale, options) {
        return new NativeFormat(locale, options);
      });
    formatDateTime("2030-01-01T00:00:00Z");
    formatDateTime("2030-01-01T00:00:00Z");
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it("preserves invalid-input failures after warming the cache", () => {
    setActiveTimePreferences({
      timeZone: "UTC",
      hourCycle: "h23",
      weekStart: null,
    });
    formatDateTime("2030-01-01T00:00:00Z");
    expect(() => formatDateTime("invalid")).toThrow(RangeError);
  });

  it("reuses locale collators and preserves case, accents, and Chinese ordering", () => {
    const pairs = [
      ["alpha", "ALPHA"],
      ["\u00e9clair", "zebra"],
      ["\u5f20", "\u674e"],
      ["a-b", "ab"],
    ] as const;
    const NativeCollator = Intl.Collator;
    const construct = vi
      .spyOn(Intl, "Collator")
      // biome-ignore lint/complexity/useArrowFunction: The mock must be constructible.
      .mockImplementation(function (locale, options) {
        return new NativeCollator(locale, options);
      });
    for (const locale of ["en", "zh-Hans", "zh-Hant", "en"] as const) {
      setActiveLocale(locale, en);
      for (let index = 0; index < 100; index++)
        for (const [a, b] of pairs)
          expect(Math.sign(compareNames(a, b))).toBe(
            Math.sign(a.localeCompare(b, locale, { sensitivity: "base" })),
          );
    }
    expect(construct).toHaveBeenCalledTimes(3);
  });
});

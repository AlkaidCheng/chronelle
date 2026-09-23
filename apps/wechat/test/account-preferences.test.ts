import { describe, expect, it } from "vitest";

import {
  preferencesUpdate,
  PreferencesValidationError,
  type AccountPreferences,
} from "../src/features/account-preferences/preferences";

const original: AccountPreferences = {
  locale: "en-US",
  timeZone: "America/New_York",
  hourCycle: "h12",
  weekStart: 7,
};

describe("account preferences", () => {
  it("sends only changed typed fields", () => {
    expect(
      preferencesUpdate(original, {
        ...original,
        hourCycle: "h23",
        weekStart: 1,
      }),
    ).toEqual({ hourCycle: "h23", weekStart: 1 });
    expect(preferencesUpdate(original, original)).toEqual({});
  });

  it("clears selected fields without altering others", () => {
    expect(
      preferencesUpdate(original, {
        ...original,
        locale: null,
        timeZone: "  ",
      }),
    ).toEqual({ locale: null, timeZone: null });
  });

  it("preserves custom account locales until changed", () => {
    const current = { ...original, locale: "fr-FR" };
    expect(preferencesUpdate(current, current)).toEqual({});
    expect(preferencesUpdate(current, { ...current, locale: "zh-CN" })).toEqual(
      {
        locale: "zh-CN",
      },
    );
  });

  it("validates IANA time zones before creating a request", () => {
    expect(() =>
      preferencesUpdate(original, { ...original, timeZone: "Not a zone" }),
    ).toThrowError(new PreferencesValidationError("time-zone-format"));
    expect(() =>
      preferencesUpdate(original, { ...original, timeZone: "Fake/Zone" }),
    ).toThrowError(new PreferencesValidationError("time-zone-unknown"));
    expect(
      preferencesUpdate(original, {
        ...original,
        timeZone: " Asia/Shanghai ",
      }),
    ).toEqual({ timeZone: "Asia/Shanghai" });
  });

  it("leaves an unchanged time zone outside the device list alone", () => {
    const current = { ...original, timeZone: "Region/Elsewhere" };
    expect(preferencesUpdate(current, { ...current, weekStart: 1 })).toEqual({
      weekStart: 1,
    });
  });
});

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

  it("checks time zone syntax and leaves zone lookup to the API", () => {
    expect(() =>
      preferencesUpdate(original, { ...original, timeZone: "Not a zone" }),
    ).toThrowError(PreferencesValidationError);
    expect(
      preferencesUpdate(original, { ...original, timeZone: "Fake/Zone" }),
    ).toEqual({ timeZone: "Fake/Zone" });
    expect(
      preferencesUpdate(original, {
        ...original,
        timeZone: " Asia/Shanghai ",
      }),
    ).toEqual({ timeZone: "Asia/Shanghai" });
  });

  it("preserves an unchanged time zone without device lookup", () => {
    const current = { ...original, timeZone: "Region/Elsewhere" };
    expect(preferencesUpdate(current, { ...current, weekStart: 1 })).toEqual({
      weekStart: 1,
    });
  });
});

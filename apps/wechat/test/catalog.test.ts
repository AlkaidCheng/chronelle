import { describe, expect, it } from "vitest";

import {
  getMessages,
  interpolate,
  resolveLocale,
  supportedLocales,
} from "../src/i18n/catalog";

describe("Mini Program message catalog", () => {
  it("selects English explicitly and defaults other languages to Simplified Chinese", () => {
    expect(resolveLocale("en-US")).toBe("en-US");
    expect(resolveLocale("EN-gb")).toBe("en-US");
    expect(resolveLocale("zh-Hans")).toBe("zh-CN");
    expect(resolveLocale(undefined)).toBe("zh-CN");
  });

  it("keeps every locale structurally complete", () => {
    const baselineKeys = Object.keys(getMessages("en-US")).sort();
    for (const locale of supportedLocales) {
      expect(Object.keys(getMessages(locale)).sort()).toEqual(baselineKeys);
      expect(
        Object.values(getMessages(locale)).every(
          (value) => value.trim().length > 0,
        ),
      ).toBe(true);
    }
  });

  it("interpolates named values without dropping unknown placeholders", () => {
    expect(
      interpolate("Shared by {name} in {workspace}", { name: "Lin" }),
    ).toBe("Shared by Lin in {workspace}");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  acceptedLanguages,
  defaultLocale,
  localeChain,
  locales,
  negotiateLocale,
} from "../i18n/locales";
import { loadMessages } from "../i18n/messages";

type Catalog = { readonly [key: string]: string | Catalog };

function catalog(tag: string): Catalog {
  const path = join(__dirname, "..", "messages", `${tag}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Catalog;
}

/** Every leaf of a catalog as `namespace.key`, with its message. */
function leaves(tree: Catalog, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") result.set(path, value);
    else
      for (const [inner, message] of leaves(value, path))
        result.set(inner, message);
  }
  return result;
}

/** The named ICU arguments of a message, `{name}` and `{name, plural, ...}`. */
function parameters(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

describe("message catalogs", () => {
  const reference = leaves(catalog(defaultLocale));

  it("keeps a message for every key of the default locale, and no others", () => {
    for (const locale of locales) {
      if (locale.tag === defaultLocale) continue;
      const translated = leaves(catalog(locale.tag));
      const missing = [...reference.keys()].filter(
        (key) => !translated.has(key),
      );
      const extra = [...translated.keys()].filter((key) => !reference.has(key));
      expect({ locale: locale.tag, missing, extra }).toEqual({
        locale: locale.tag,
        missing: [],
        extra: [],
      });
    }
  });

  it("names the same parameters in every translation", () => {
    for (const locale of locales) {
      if (locale.tag === defaultLocale) continue;
      const translated = leaves(catalog(locale.tag));
      for (const [key, message] of reference) {
        expect({
          locale: locale.tag,
          key,
          parameters: parameters(translated.get(key) ?? ""),
        }).toEqual({
          locale: locale.tag,
          key,
          parameters: parameters(message),
        });
      }
    }
  });

  it("merges a locale over its fallbacks", async () => {
    expect(localeChain("zh-Hant")).toEqual(["zh-Hant", "zh-Hans", "en"]);
    const messages = leaves((await loadMessages("zh-Hant")) as Catalog);
    expect(messages.get("nav.trash")).toBe(
      leaves(catalog("zh-Hant")).get("nav.trash"),
    );
    expect([...messages.keys()].sort()).toEqual([...reference.keys()].sort());
  });
});

describe("locale negotiation", () => {
  it.each([
    ["zh-TW", "zh-Hant"],
    ["zh-HK,zh;q=0.8", "zh-Hant"],
    ["zh-Hant-TW", "zh-Hant"],
    ["zh-CN", "zh-Hans"],
    ["zh", "zh-Hans"],
    ["zh-SG,en;q=0.9", "zh-Hans"],
    ["en-GB", "en"],
    ["fr", "en"],
    ["fr,zh-TW;q=0.7", "zh-Hant"],
    ["", "en"],
  ])("maps %s to %s", (header, expected) => {
    expect(negotiateLocale(acceptedLanguages(header))).toBe(expected);
  });

  it("orders the header by quality and drops the wildcard", () => {
    expect(acceptedLanguages("en;q=0.5, zh-TW;q=0.9, *;q=0.1, fr;q=0")).toEqual(
      ["zh-TW", "en"],
    );
    expect(acceptedLanguages(null)).toEqual([]);
  });
});

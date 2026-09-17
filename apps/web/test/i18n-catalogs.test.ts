import { readdirSync, readFileSync } from "node:fs";
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

const messages = join(__dirname, "..", "messages");

/** The assembled catalog of a locale, as the generator writes it. */
function catalog(tag: string): Catalog {
  return JSON.parse(
    readFileSync(join(messages, `${tag}.json`), "utf8"),
  ) as Catalog;
}

/** The namespace files of a locale, the source the generator assembles. */
function namespaceFiles(tag: string): string[] {
  return readdirSync(join(messages, tag))
    .filter((name) => name.endsWith(".json"))
    .sort();
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

  it("keeps one file per namespace in every locale, each an object", () => {
    const expected = namespaceFiles(defaultLocale);
    expect(expected.length).toBeGreaterThan(0);
    for (const locale of locales) {
      expect({ locale: locale.tag, files: namespaceFiles(locale.tag) }).toEqual(
        {
          locale: locale.tag,
          files: expected,
        },
      );
      for (const file of expected) {
        const parsed: unknown = JSON.parse(
          readFileSync(join(messages, locale.tag, file), "utf8"),
        );
        expect(
          typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed),
          `${locale.tag}/${file}`,
        ).toBe(true);
      }
    }
  });

  it("assembles each catalog from its namespace files", () => {
    for (const locale of locales) {
      const assembled = catalog(locale.tag);
      expect(Object.keys(assembled)).toEqual(
        namespaceFiles(locale.tag).map((file) =>
          file.slice(0, -".json".length),
        ),
      );
    }
  });

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

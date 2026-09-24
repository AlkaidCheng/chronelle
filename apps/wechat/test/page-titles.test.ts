import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getMessages } from "../src/i18n/catalog";

const source = new URL("../src/", import.meta.url);

const pageConfigs = readdirSync(source, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith(".config.ts") && path !== "app.config.ts");

function staticTitle(path: string): string | undefined {
  return /navigationBarTitleText: "([^"]*)"/u.exec(
    readFileSync(new URL(path, source), "utf8"),
  )?.[1];
}

describe("page titles", () => {
  it("finds the page configs", () => {
    expect(pageConfigs.length).toBeGreaterThan(10);
  });

  it("titles every page with the product name or a word in the fallback language", () => {
    const words = new Set(Object.values(getMessages("zh-CN")));
    for (const path of pageConfigs) {
      const title = staticTitle(path);
      expect(
        title === undefined || title === "Chronelle" || words.has(title),
        `${path}: ${title}`,
      ).toBe(true);
    }
  });
});

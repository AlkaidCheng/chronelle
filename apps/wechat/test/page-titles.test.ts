import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getMessages } from "../src/i18n/catalog";

const source = new URL("../src/", import.meta.url);
const productName = "LivTales";

const pageConfigs = readdirSync(source, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith(".config.ts") && path !== "app.config.ts");

function staticTitle(path: string): string | undefined {
  return /navigationBarTitleText: "([^"]*)"/u.exec(
    readFileSync(new URL(path, source), "utf8"),
  )?.[1];
}

describe("page titles", () => {
  it("titles the app window with the product name", () => {
    expect(staticTitle("app.config.ts")).toBe(productName);
  });

  it("finds the page configs", () => {
    expect(pageConfigs.length).toBeGreaterThan(10);
  });

  it("titles every page with the product name or a word in the fallback language", () => {
    const words = new Set(Object.values(getMessages("zh-CN")));
    for (const path of pageConfigs) {
      const title = staticTitle(path);
      expect(
        title === undefined || title === productName || words.has(title),
        `${path}: ${title}`,
      ).toBe(true);
    }
  });
});

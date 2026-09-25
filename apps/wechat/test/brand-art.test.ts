import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const repository = new URL("../../../", import.meta.url);
const source = new URL("../src/", import.meta.url);

/** An SVG embedded in a stylesheet as a base64 data URI. */
interface EmbeddedSvg {
  /** The stylesheet, relative to src/. */
  readonly stylesheet: string;
  /** The brand file named by the comment on the line above, relative to the repository. */
  readonly brandSource: string | undefined;
  readonly bytes: Buffer;
}

const svgDataUri = /url\("data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"\)/gu;
const brandSourceComment = /^\s*\/\/ (brand\/[\w/-]+\.svg)$/u;

const stylesheets = readdirSync(source, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith(".scss"));

function read(stylesheet: string): string {
  return readFileSync(new URL(stylesheet, source), "utf8");
}

function embeddedSvgs(stylesheet: string): EmbeddedSvg[] {
  const text = read(stylesheet);
  return [...text.matchAll(svgDataUri)].map((match) => ({
    stylesheet,
    brandSource: brandSourceComment.exec(
      text.slice(0, match.index).split("\n").at(-2) ?? "",
    )?.[1],
    bytes: Buffer.from(match[1] ?? "", "base64"),
  }));
}

const embedded = stylesheets.flatMap(embeddedSvgs);
const brandArt = embedded.filter(
  ({ brandSource, bytes }) =>
    brandSource !== undefined || bytes.toString("utf8").includes("LivTales"),
);

describe("Mini Program brand art", () => {
  it("embeds every SVG as base64, so each one can be decoded and checked", () => {
    const declared = stylesheets.reduce(
      (count, stylesheet) =>
        count + read(stylesheet).split("data:image/svg+xml").length - 1,
      0,
    );
    expect(embedded).toHaveLength(declared);
  });

  it("draws the lockup from the light and dark header logos", () => {
    expect(
      brandArt.map(({ stylesheet, brandSource }) => [stylesheet, brandSource]),
    ).toEqual([
      ["shell/brand.scss", "brand/logo/header-logo-light.svg"],
      ["shell/brand.scss", "brand/logo/header-logo-dark.svg"],
    ]);
  });

  it.each(brandArt)(
    "embeds $brandSource byte for byte",
    ({ brandSource, bytes }) => {
      expect(bytes).toEqual(
        readFileSync(new URL(String(brandSource), repository)),
      );
    },
  );

  it.each(brandArt)("draws $brandSource as outlines only", ({ bytes }) => {
    const svg = bytes.toString("utf8");
    const elements = new Set(
      [...svg.matchAll(/<([A-Za-z][\w:-]*)/gu)].map((match) => match[1]),
    );
    expect(svg).not.toContain("<text");
    expect(elements.has("path")).toBe(true);
    expect(
      [...elements].filter(
        (name) => !["g", "path", "svg", "title"].includes(name ?? ""),
      ),
    ).toEqual([]);
  });

  it("keeps the build's CSS minimizer from rewriting the embedded SVGs", () => {
    expect(
      readFileSync(new URL("../config/index.ts", import.meta.url), "utf8"),
    ).toMatch(/csso: \{\s*enable: true,\s*config: \{\s*svgo: false,/u);
  });

  it("names the lockup in text, since Taro leaves aria attributes out of the WXML", () => {
    const lockup = readFileSync(new URL("shell/brand.tsx", source), "utf8");
    expect(lockup).toContain(
      '<Text className="brand-lockup__name">LivTales</Text>',
    );
    const hidden = /\.brand-lockup__name \{([^}]*)\}/u.exec(
      read("shell/brand.scss"),
    )?.[1];
    for (const declaration of [
      "position: absolute;",
      "overflow: hidden;",
      "clip: rect(0 0 0 0);",
    ])
      expect(hidden).toContain(declaration);
  });

  it("switches to the dark art only under the dark colour scheme", () => {
    const text = read("shell/brand.scss");
    const darkScheme = text.indexOf("@media (prefers-color-scheme: dark)");
    expect(darkScheme).toBeGreaterThan(0);
    expect(text.indexOf("// brand/logo/header-logo-light.svg")).toBeLessThan(
      darkScheme,
    );
    expect(text.indexOf("// brand/logo/header-logo-dark.svg")).toBeGreaterThan(
      darkScheme,
    );
  });
});

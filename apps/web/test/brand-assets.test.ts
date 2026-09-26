import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import manifest from "../app/manifest";
import { BrandLogo } from "../components/brand-logo";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const web = join(__dirname, "..");
const repository = join(web, "..", "..");
const brand = join(repository, "brand");

const webFile = (path: string) => readFileSync(join(web, path));
const brandFile = (path: string) => readFileSync(join(brand, path));
/** The SHA-256, in hex, of a file named relative to the repository root. */
const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(repository, path)))
    .digest("hex");

/** The attributes of each element named `tag`, in document order. */
function elements(svg: string, tag: string): Map<string, string>[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map(
    (element) =>
      new Map(
        [...(element[1] ?? "").matchAll(/([\w:-]+)="([^"]*)"/g)].map(
          ([, name, value]) => [name ?? "", value ?? ""],
        ),
      ),
  );
}

/** The drawing of a logo: the frame, the group transforms, and the paths. */
function drawing(svg: string) {
  return {
    viewBox: elements(svg, "svg")[0]?.get("viewBox"),
    transforms: elements(svg, "g").map((group) => group.get("transform")),
    paths: elements(svg, "path").map((path) => path.get("d")),
  };
}

/** Width, height, and colour type from a PNG's IHDR chunk. */
function png(data: Buffer) {
  expect(data.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(data.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colourType: data.readUInt8(25),
  };
}

/** Width and height from a JPEG's start-of-frame segment. */
function jpeg(data: Buffer) {
  expect(data.readUInt16BE(0)).toBe(0xffd8);
  let offset = 2;
  while (offset < data.length) {
    const marker = data.readUInt16BE(offset);
    const frame =
      marker >= 0xffc0 &&
      marker <= 0xffcf &&
      ![0xffc4, 0xffc8, 0xffcc].includes(marker);
    if (frame)
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  throw new Error("The JPEG has no start-of-frame segment.");
}

/** The square sizes an ICO file carries (a 0 in its directory means 256). */
function icoSizes(data: Buffer): number[] {
  expect(data.readUInt16LE(0)).toBe(0);
  expect(data.readUInt16LE(2)).toBe(1);
  return Array.from({ length: data.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16;
    const width = data.readUInt8(entry) || 256;
    expect(data.readUInt8(entry + 1) || 256).toBe(width);
    return width;
  });
}

/** PNG colour types with an alpha channel: grey + alpha and RGBA. */
const alphaColourTypes = [4, 6];

describe("the logo", () => {
  const light = brandFile("logo/header-logo-light.svg").toString("utf8");
  const dark = brandFile("logo/header-logo-dark.svg").toString("utf8");
  const logo = renderToStaticMarkup(createElement(BrandLogo));

  it("draws the header lockup exactly as the brand source does", () => {
    const source = drawing(light);
    expect(source.paths).toHaveLength(5);
    expect(drawing(logo)).toEqual(source);
    // One drawing serves both appearances: only the fills differ.
    expect(drawing(dark)).toEqual(source);
  });

  it("is an image named LivTales, sized as the source is", () => {
    const [svg] = elements(logo, "svg");
    expect(svg?.get("role")).toBe("img");
    expect(svg?.get("aria-label")).toBe("LivTales");
    const [source] = elements(light, "svg");
    expect([svg?.get("width"), svg?.get("height")]).toEqual([
      source?.get("width"),
      source?.get("height"),
    ]);
  });

  it("paints each part with a token drawn from the palette", () => {
    const styles = webFile("app/styles.css").toString("utf8");
    const brandTokens = new Map(
      [
        ...webFile("app/tokens.css")
          .toString("utf8")
          .matchAll(/--brand-([\w-]+):\s*([^;]+);/g),
      ].map(([, role, value]) => [role ?? "", value ?? ""]),
    );
    /** A token's value with each --brand-* token it names written out. */
    const expand = (value: string): string =>
      value.replace(/var\(--brand-([\w-]+)\)/g, (_, role: string) =>
        expand(brandTokens.get(role) ?? ""),
      );
    elements(logo, "path").forEach((path, index) => {
      const role = /^brand-logo-([\w-]+)$/.exec(path.get("class") ?? "")?.[1];
      expect(role, `path ${index}`).toBeDefined();
      expect(styles).toContain(
        `.brand-logo-${role} {\n  fill: var(--brand-${role});\n}`,
      );
      const value = expand(brandTokens.get(role ?? "") ?? "");
      expect(value, `--brand-${role}`).toMatch(/var\(--(accent|ink)\)/);
      // A fixed colour would stop the part following the palette.
      expect(value, `--brand-${role}`).not.toMatch(/#[\da-f]{3,8}\b|rgb|hsl/i);
    });
  });
});

describe("the icons", () => {
  it("serves the brand's favicon and app icon as they are drawn", () => {
    expect(webFile("app/icon.svg").equals(brandFile("icon/favicon.svg"))).toBe(
      true,
    );
    expect(
      webFile("public/icons/pwa-icon.svg").equals(
        brandFile("icon/pwa-icon.svg"),
      ),
    ).toBe(true);
  });

  it("lists in the manifest only icons that exist at their declared size", () => {
    const app = manifest();
    expect(app.name).toBe("LivTales");
    expect(app.short_name).toBe("LivTales");
    const icons = app.icons ?? [];
    expect(icons.map((icon) => icon.type)).toContain("image/svg+xml");
    for (const icon of icons) {
      const path = join(web, "public", icon.src);
      expect(existsSync(path), icon.src).toBe(true);
      const data = readFileSync(path);
      if (icon.type === "image/svg+xml") {
        expect(icon.sizes, icon.src).toBe("any");
        expect(data.toString("utf8"), icon.src).toMatch(/^<svg\b/);
        continue;
      }
      expect(icon.type, icon.src).toBe("image/png");
      const { width, height, colourType } = png(data);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
      // A maskable icon fills its canvas: the platform cuts the shape.
      if (icon.purpose === "maskable")
        expect(alphaColourTypes, icon.src).not.toContain(colourType);
    }
  });

  it("keeps a favicon.ico for browsers without SVG icons, at 16, 32 and 48", () => {
    expect(icoSizes(webFile("app/favicon.ico"))).toEqual(
      expect.arrayContaining([16, 32, 48]),
    );
  });

  it("gives iOS an opaque 180 px home-screen icon", () => {
    const icon = png(webFile("app/apple-icon.png"));
    expect([icon.width, icon.height]).toEqual([180, 180]);
    expect(alphaColourTypes).not.toContain(icon.colourType);
  });

  it("previews a shared link with a 1200 x 630 image and its description", () => {
    expect(jpeg(webFile("app/opengraph-image.jpg"))).toEqual({
      width: 1200,
      height: 630,
    });
    expect(webFile("app/opengraph-image.alt.txt").toString("utf8")).toMatch(
      /LivTales/,
    );
  });
});

describe("the rasters", () => {
  /** What `pnpm brand:export --web` copied: each file's digest and its sources'. */
  const stamp = JSON.parse(
    webFile("app/brand-rasters.json").toString("utf8"),
  ) as Record<string, { sha256: string; sources: Record<string, string> }>;
  const pngIcons = (manifest().icons ?? []).filter(
    (icon) => icon.type === "image/png",
  );

  it("are the export of the brand sources and script as they stand", () => {
    const served = [
      "app/favicon.ico",
      "app/apple-icon.png",
      "app/opengraph-image.jpg",
      "app/opengraph-image.alt.txt",
      ...pngIcons.map((icon) => `public${icon.src}`),
    ].map((path) => `apps/web/${path}`);
    expect(Object.keys(stamp).sort()).toEqual(served.sort());
    const rerun = "changed since the last `pnpm brand:export --web`";
    for (const [copy, record] of Object.entries(stamp)) {
      expect(sha256(copy), `${copy} ${rerun}`).toBe(record.sha256);
      const sources = Object.keys(record.sources);
      expect(sources, copy).toContain("brand/scripts/export.mjs");
      for (const source of sources) {
        // The apps ship the default theme, whose sources sit at the top of brand/.
        expect(source, copy).not.toMatch(/^brand\/themes\//);
        expect(sha256(source), `${source} ${rerun}`).toBe(
          record.sources[source],
        );
      }
    }
  });

  it("draws the manifest's PNG icons from the SVG icon beside them", () => {
    for (const icon of pngIcons.filter((icon) => icon.purpose === "any"))
      expect(
        Object.keys(stamp[`apps/web/public${icon.src}`]?.sources ?? {}),
        icon.src,
      ).toContain("brand/icon/pwa-icon.svg");
  });
});

describe("the site metadata", () => {
  it("names the site LivTales, on the origin the page was asked for", async () => {
    const { generateMetadata } = await import("../app/layout");
    request.headers = new Headers({
      host: "web:3000",
      "x-forwarded-host": "livtales.example, proxy.internal",
      "x-forwarded-proto": "https",
    });
    const metadata = await generateMetadata();
    expect(metadata.title).toEqual({
      default: "LivTales",
      template: "%s | LivTales",
    });
    expect(metadata.applicationName).toBe("LivTales");
    expect(metadata.appleWebApp).toMatchObject({ title: "LivTales" });
    expect(metadata.openGraph).toMatchObject({ siteName: "LivTales" });
    expect(String(metadata.metadataBase)).toBe("https://livtales.example/");

    request.headers = new Headers({ host: "localhost:3000" });
    expect(String((await generateMetadata()).metadataBase)).toBe(
      "http://localhost:3000/",
    );
  });
});

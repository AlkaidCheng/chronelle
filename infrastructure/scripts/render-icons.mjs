// Renders the raster app icons from apps/web/app/icon.svg with the Playwright
// Chromium the journeys use, so the home-screen and iOS icons are the same
// mark as the tab's SVG. Run from the repository root:
//
//   node infrastructure/scripts/render-icons.mjs
//
// Outputs: apps/web/public/icons/icon-192.png and icon-512.png (the tile with
// its rounded corners on a transparent canvas), icon-maskable-512.png (the
// tile colour filling the whole canvas, the glyph inside the central safe
// zone), and apps/web/app/apple-icon.png (180, opaque, iOS rounds it).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "apps/web/app/icon.svg"), "utf8");
const tile = /<path d="[^"]*" fill="(#[0-9a-f]{6})"\/>/i.exec(source);
if (tile === null) throw new Error("icon.svg has no tile path.");
const tileColour = tile[1];

// The maskable variant paints the tile colour edge to edge; the glyph keeps
// its place, which lies inside the central 80% the platforms may show.
const maskable = source.replace(
  tile[0],
  `<rect width="64" height="64" fill="${tileColour}"/>`,
);

const outputs = [
  { file: "apps/web/public/icons/icon-192.png", size: 192, svg: source },
  { file: "apps/web/public/icons/icon-512.png", size: 512, svg: source },
  {
    file: "apps/web/public/icons/icon-maskable-512.png",
    size: 512,
    svg: maskable,
  },
  { file: "apps/web/app/apple-icon.png", size: 180, svg: maskable },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const output of outputs) {
    await page.setViewportSize({ width: output.size, height: output.size });
    const data = `data:image/svg+xml;utf8,${encodeURIComponent(output.svg)}`;
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img src="${data}" width="${output.size}" height="${output.size}" style="display:block"></body></html>`,
    );
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: output.size, height: output.size },
    });
    const path = join(root, output.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    console.log(
      `${output.file} ${output.size}x${output.size} ${png.length} bytes`,
    );
  }
} finally {
  await browser.close();
}

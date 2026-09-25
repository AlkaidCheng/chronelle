#!/usr/bin/env node
/**
 * Renders the LivTales brand SVG sources to every raster a platform needs.
 *
 * Usage:
 *   node brand/scripts/export.mjs [--theme <name>] [--web]
 *   pnpm brand:export [--theme <name>] [--web]
 *
 *   --theme <name>  night-voyage (the default; sources in brand/) or a backup theme
 *                   under brand/themes/<name>/, such as polar-aurora.
 *   --web           also refresh the rasters the web app commits:
 *                   apps/web/app/{favicon.ico, apple-icon.png, opengraph-image.jpg,
 *                   opengraph-image.alt.txt} and apps/web/public/icons/*.png, and
 *                   record in apps/web/app/brand-rasters.json the SHA-256 of each
 *                   copy and of the sources and script it was drawn from.
 *
 * Output goes to brand/dist/<theme>/ (git-ignored), one folder per platform: web, ios,
 * android, wechat, macos (LivTales.icns is built with iconutil on macOS only) and
 * windows. Chromium from @playwright/test draws each SVG at its exact pixel size (run
 * `pnpm exec playwright install chromium` once). PNG and ICO files are encoded here with
 * node:zlib, so opaque outputs are RGB PNGs without an alpha channel.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_THEME = "night-voyage";

/** iOS and legacy Android canvases this size or smaller use the small-size art. */
const SMALL_ART_MAX = 60;
/**
 * Desktop icons this size or smaller use flat art, without the aurora and glow that
 * smudge at taskbar and Finder sizes.
 */
const FLAT_ART_MAX = { windows: 48, macos: 32 };
/** Corner radius of the Windows app icon, as a fraction of the tile. */
const WINDOWS_RADIUS = 0.08;
/**
 * The Big Sur grid drawn in icon/macos-icon.svg, applied to the flat art: an 824 tile at
 * (100, 100) on the 1024 canvas, radius 185, and a 30% black shadow 12 down with a 12 blur.
 */
const MACOS_TILE = {
  inset: 100 / 1024,
  radius: 185 / 824,
  shadow: { offset: 12 / 1024, blur: 12 / 1024, opacity: 0.3 },
};
/** Legacy Android launcher icons: a 44 dp tile centred in the 48 dp canvas. */
const ANDROID_LEGACY = { inset: 2 / 48, radius: 0.18 };
const ANDROID_DENSITIES = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};
/**
 * Foreground scale for a maskable icon composed from the Android layers, as in
 * brand/icon/maskable.svg: the mark and its shadow stay inside the central 80% circle.
 */
const MASKABLE_MARK_SCALE = 0.85;
const JPEG_QUALITY = 90;
/** Next.js puts opengraph-image.alt.txt into og:image:alt verbatim: no final newline. */
const OG_ALT =
  "The LivTales logo, an open book whose right page rises into a sail, beside the name LivTales.";

/** Where --web copies each output, relative to the repository root. */
const WEB_APP_FILES = {
  "web/favicon.ico": "apps/web/app/favicon.ico",
  "web/apple-touch-icon.png": "apps/web/app/apple-icon.png",
  "web/og-image.jpg": "apps/web/app/opengraph-image.jpg",
  "web/og-image.alt.txt": "apps/web/app/opengraph-image.alt.txt",
  "web/icon-192.png": "apps/web/public/icons/icon-192.png",
  "web/icon-512.png": "apps/web/public/icons/icon-512.png",
  "web/icon-maskable-512.png": "apps/web/public/icons/icon-maskable-512.png",
};
/** The record of what --web copied, which apps/web/test/brand-assets.test.ts checks. */
const WEB_STAMP = "apps/web/app/brand-rasters.json";

const ANDROID_ADAPTIVE_ICON = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;

const IOS_CONTENTS = {
  images: [
    { filename: "AppIcon-1024.png" },
    { filename: "AppIcon-dark-1024.png", appearance: "dark" },
    { filename: "AppIcon-tinted-1024.png", appearance: "tinted" },
  ].map(({ filename, appearance }) => ({
    ...(appearance && {
      appearances: [{ appearance: "luminosity", value: appearance }],
    }),
    filename,
    idiom: "universal",
    platform: "ios",
    size: "1024x1024",
  })),
  info: { author: "xcode", version: 1 },
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CHANNELS = { 2: 3, 6: 4 }; // colour type -> channels (RGB, RGBA)

async function main() {
  const { values: options } = parseArgs({
    options: {
      theme: { type: "string", default: DEFAULT_THEME },
      web: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (options.help) {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    console.log(/\/\*\*([\s\S]*?)\*\//.exec(source)[1].replace(/^ \* ?/gm, ""));
    return;
  }

  const { theme } = options;
  const outDir = join(ROOT, "brand", "dist", theme);
  const { sources, origins } = loadSources(resolveTheme(theme));
  const outputs = planOutputs(sources);

  rmSync(outDir, { recursive: true, force: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const output of outputs) {
      const bytes = await produce(page, output).catch((error) => {
        throw new Error(`${output.path}: ${error.message}`, { cause: error });
      });
      const file = join(outDir, output.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      console.log(output.path);
    }
  } finally {
    await browser.close();
  }

  if (process.platform === "darwin") {
    execFileSync("iconutil", [
      "-c",
      "icns",
      join(outDir, "macos/LivTales.iconset"),
      "-o",
      join(outDir, "macos/LivTales.icns"),
    ]);
    console.log("macos/LivTales.icns");
  } else {
    console.log("Skipped macos/LivTales.icns: iconutil needs macOS");
  }

  if (options.web) copyWebFiles(outDir, outputs, origins);
  console.log(`Exported the ${theme} theme to brand/dist/${theme}/`);
}

/** Returns the source directory of a theme: brand/ for the default one. */
function resolveTheme(name) {
  const dir =
    name === DEFAULT_THEME
      ? join(ROOT, "brand")
      : join(ROOT, "brand", "themes", name);
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(join(dir, "icon"))) {
    const themes = readdirSync(join(ROOT, "brand/themes"), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory());
    const names = [DEFAULT_THEME, ...themes.map((entry) => entry.name)];
    throw new Error(
      `Unknown theme "${name}". Choose one of: ${names.join(", ")}.`,
    );
  }
  return dir;
}

/**
 * Reads every SVG source the outputs draw from. `origins` maps each source's text to
 * the files, relative to the repository root, it came from.
 */
function loadSources(dir) {
  const origins = new Map();
  const read = (path) => {
    const file = join(dir, path);
    if (!existsSync(file)) throw new Error(`Missing source ${file}`);
    const text = readFileSync(file, "utf8");
    origins.set(text, [repositoryPath(file)]);
    return text;
  };
  const sources = {
    appIcon: read("icon/app-icon.svg"),
    appIconSmall: read("icon/app-icon-small.svg"),
    appIconFlat: read("icon/app-icon-flat.svg"),
    appIconFlatMacos: read("icon/app-icon-flat-macos.svg"),
    pwaIcon: read("icon/pwa-icon.svg"),
    appIconDark: read("icon/app-icon-dark.svg"),
    appIconTinted: read("icon/app-icon-tinted.svg"),
    androidBackground: read("icon/android-background.svg"),
    androidForeground: read("icon/android-foreground.svg"),
    androidMonochrome: read("icon/android-monochrome.svg"),
    favicon: read("icon/favicon.svg"),
    macosIcon: read("icon/macos-icon.svg"),
    wechatAvatar: read("icon/wechat-avatar.svg"),
    ogImage: read("social/og-image.svg"),
  };
  if (existsSync(join(dir, "icon/maskable.svg"))) {
    sources.maskable = read("icon/maskable.svg");
  } else {
    console.log(
      "icon/maskable.svg not found: composing it from the Android layers",
    );
    sources.maskable = composeMaskable(
      sources.androidBackground,
      sources.androidForeground,
    );
    origins.set(sources.maskable, [
      ...origins.get(sources.androidBackground),
      ...origins.get(sources.androidForeground),
    ]);
  }
  return { sources, origins };
}

/**
 * Lists every output file. A raster draws `svg` at `size` (or `width` x `height`) pixels;
 * `opaque` drops the alpha channel, `jpeg` encodes a JPEG, `inset`, `radius` (fractions
 * of the canvas and of the tile) and `shadow` place the art on a rounded tile. `ico`
 * bundles several rasters into one icon file, and `text` is written as is.
 */
function planOutputs(src) {
  const appArt = (size) =>
    size <= SMALL_ART_MAX ? src.appIconSmall : src.appIcon;

  const web = [
    {
      path: "web/favicon.ico",
      ico: [16, 32, 48].map((size) => ({ svg: src.favicon, size })),
    },
    {
      path: "web/apple-touch-icon.png",
      svg: src.appIcon,
      size: 180,
      opaque: true,
    },
    ...[192, 512].map((size) => ({
      path: `web/icon-${size}.png`,
      svg: src.pwaIcon,
      size,
    })),
    {
      path: "web/icon-maskable-512.png",
      svg: src.maskable,
      size: 512,
      opaque: true,
    },
    // The maskable source as rendered, so a composed one can be reviewed and adopted.
    { path: "web/maskable.svg", text: src.maskable },
    {
      path: "web/og-image.jpg",
      svg: src.ogImage,
      width: 1200,
      height: 630,
      jpeg: true,
    },
    { path: "web/og-image.alt.txt", text: OG_ALT },
  ];

  const ios = [
    {
      path: "ios/AppIcon-1024.png",
      svg: src.appIcon,
      size: 1024,
      opaque: true,
    },
    { path: "ios/AppIcon-dark-1024.png", svg: src.appIconDark, size: 1024 },
    { path: "ios/AppIcon-tinted-1024.png", svg: src.appIconTinted, size: 1024 },
    ...[40, 58, 60, 80, 87, 120, 152, 167, 180].map((size) => ({
      path: `ios/AppIcon-${size}.png`,
      svg: appArt(size),
      size,
      opaque: true,
    })),
    {
      path: "ios/Contents.json",
      text: `${JSON.stringify(IOS_CONTENTS, null, 2)}\n`,
    },
  ];

  const android = [
    ...Object.entries(ANDROID_DENSITIES).flatMap(([density, scale]) => {
      const dir = `android/mipmap-${density}`;
      const layer = 108 * scale;
      const legacy = 48 * scale;
      return [
        {
          path: `${dir}/ic_launcher_background.png`,
          svg: src.androidBackground,
          size: layer,
          opaque: true,
        },
        {
          path: `${dir}/ic_launcher_foreground.png`,
          svg: src.androidForeground,
          size: layer,
        },
        {
          path: `${dir}/ic_launcher_monochrome.png`,
          svg: src.androidMonochrome,
          size: layer,
        },
        {
          path: `${dir}/ic_launcher.png`,
          svg: appArt(legacy),
          size: legacy,
          ...ANDROID_LEGACY,
        },
        {
          path: `${dir}/ic_launcher_round.png`,
          svg: appArt(legacy),
          size: legacy,
          ...ANDROID_LEGACY,
          radius: 0.5,
        },
      ];
    }),
    ...["ic_launcher", "ic_launcher_round"].map((name) => ({
      path: `android/mipmap-anydpi-v26/${name}.xml`,
      text: ANDROID_ADAPTIVE_ICON,
    })),
    {
      path: "android/play-store-512.png",
      svg: src.appIcon,
      size: 512,
      opaque: true,
    },
  ];

  const wechat = [512, 144].map((size) => ({
    path: `wechat/avatar-${size}.png`,
    svg: src.wechatAvatar,
    size,
    opaque: true,
  }));

  const macos = [16, 32, 128, 256, 512].flatMap((points) =>
    [1, 2].map((scale) => {
      const size = points * scale;
      const suffix = scale === 2 ? "@2x" : "";
      return {
        path: `macos/LivTales.iconset/icon_${points}x${points}${suffix}.png`,
        size,
        ...(size <= FLAT_ART_MAX.macos
          ? { svg: src.appIconFlatMacos, ...MACOS_TILE }
          : { svg: src.macosIcon }),
      };
    }),
  );

  const windows = [
    {
      path: "windows/LivTales.ico",
      ico: [16, 24, 32, 48, 64, 128, 256].map((size) => ({
        svg: size <= FLAT_ART_MAX.windows ? src.appIconFlat : src.appIcon,
        size,
        radius: WINDOWS_RADIUS,
      })),
    },
  ];

  return [...web, ...ios, ...android, ...wechat, ...macos, ...windows];
}

/**
 * Copies the web outputs into apps/web and writes WEB_STAMP: for each copy, its SHA-256
 * and those of the sources and the script it was drawn from.
 */
function copyWebFiles(outDir, outputs, origins) {
  const script = repositoryPath(fileURLToPath(import.meta.url));
  const stamp = {};
  for (const [from, to] of Object.entries(WEB_APP_FILES)) {
    copyFileSync(join(outDir, from), join(ROOT, to));
    console.log(`${to} (from ${from})`);
    const output = outputs.find((entry) => entry.path === from);
    const drawn = output.ico?.map((entry) => entry.svg) ?? [output.svg];
    const sources = new Set(
      drawn.filter(Boolean).flatMap((svg) => origins.get(svg)),
    );
    stamp[to] = {
      sha256: sha256(to),
      sources: Object.fromEntries(
        [...sources, script].map((path) => [path, sha256(path)]),
      ),
    };
  }
  writeFileSync(join(ROOT, WEB_STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(WEB_STAMP);
}

/** A file's path relative to the repository root, with forward slashes. */
function repositoryPath(file) {
  return relative(ROOT, file).split(sep).join("/");
}

/** The SHA-256 of a file named relative to the repository root, in hex. */
function sha256(path) {
  return createHash("sha256")
    .update(readFileSync(join(ROOT, path)))
    .digest("hex");
}

/** Returns the bytes of one planned output. */
async function produce(page, output) {
  if (output.text !== undefined) return output.text;
  if (output.ico) {
    const images = [];
    for (const entry of output.ico) {
      images.push({ size: entry.size, png: await rasterize(page, entry) });
    }
    return encodeIco(images);
  }
  return rasterize(page, output);
}

/** Draws one SVG with Chromium and returns the encoded PNG or JPEG. */
async function rasterize(page, job) {
  const { svg, jpeg = false, opaque = false, radius, shadow } = job;
  const width = job.width ?? job.size;
  const height = job.height ?? job.size;
  // An inset tile snaps to whole pixels, so its edges stay crisp at 16 and 32 px.
  const inset = Math.floor(width * (job.inset ?? 0));
  const tile = width - 2 * inset;
  // A shadow keeps at least half a pixel of offset and blur, so it still reads small.
  const shadowOffset = shadow && Math.max(shadow.offset * width, 0.5);
  const shadowBlur = shadow && 2 * Math.max(shadow.blur * width, 0.5);
  const style = [
    `left:${inset}px`,
    `top:${inset}px`,
    `width:${tile}px`,
    `height:${height - 2 * inset}px`,
    radius && `border-radius:${radius * tile}px`,
    shadow &&
      `box-shadow:0 ${shadowOffset}px ${shadowBlur}px rgba(0,0,0,${shadow.opacity})`,
  ]
    .filter(Boolean)
    .join(";");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}img{position:absolute;display:block}</style><img alt="" style="${style}" src="${src}">`,
  );
  await page.evaluate(() => document.images[0].decode());
  const clip = { x: 0, y: 0, width, height };
  if (jpeg) {
    return page.screenshot({ type: "jpeg", quality: JPEG_QUALITY, clip });
  }
  const image = decodePng(
    await page.screenshot({ type: "png", omitBackground: true, clip }),
  );
  return encodePng(opaque ? dropAlpha(image) : image);
}

/** Converts RGBA pixels to RGB, refusing art that leaves any pixel translucent. */
function dropAlpha(image) {
  const { width, height, channels, data } = image;
  if (channels === 3) return image; // Chromium already wrote an RGB PNG
  const rgb = Buffer.alloc(width * height * 3);
  let translucent = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (data[pixel * 4 + 3] !== 255) translucent++;
    data.copy(rgb, pixel * 3, pixel * 4, pixel * 4 + 3);
  }
  if (translucent > 0) {
    throw new Error(
      `An opaque ${width}x${height} output has ${translucent} translucent pixels: its art must cover the whole canvas.`,
    );
  }
  return { width, height, channels: 3, data: rgb };
}

/**
 * Builds a maskable icon from the Android adaptive layers, for a theme without
 * icon/maskable.svg. The background's central 72 dp fills the canvas (so the 108 dp
 * layer spans 150 units), and the foreground is scaled about the centre.
 */
function composeMaskable(background, foreground) {
  const layer = (svg, prefix) => {
    const viewBox = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(svg)?.[1];
    if (!viewBox) throw new Error("An Android layer has no viewBox");
    const body = svg
      .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
      .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
    return `<svg x="-25" y="-25" width="150" height="150" viewBox="${viewBox}">${body}</svg>`;
  };
  const scale = `translate(50 50) scale(${MASKABLE_MARK_SCALE}) translate(-50 -50)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>LivTales</title>${layer(background, "bg")}<g transform="${scale}">${layer(foreground, "fg")}</g></svg>\n`;
}

// PNG and ICO encoding ------------------------------------------------------

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG, as Chromium writes them. */
function decodePng(buffer) {
  let header;
  const idat = [];
  for (let offset = PNG_SIGNATURE.length; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
  }
  const { width, height, depth, colorType, interlace } = header;
  const channels = PNG_CHANNELS[colorType];
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new Error(
      `Unsupported PNG (depth ${depth}, colour type ${colorType})`,
    );
  }
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= channels ? prev[i - channels] : 0;
      row[i] = (line[i] + predict(filter, left, up, upLeft)) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Encodes 8-bit RGB (3 channels) or RGBA (4 channels) pixels as a PNG. */
function encodePng({ width, height, channels, data }) {
  const stride = width * channels;
  const blank = Buffer.alloc(stride);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : blank;
    rows.push(filterRow(line, prev, channels));
  }
  const header = Buffer.alloc(13); // bytes 10-12: deflate, adaptive filtering, no interlace
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Filters one row with whichever PNG filter leaves the smallest residuals. */
function filterRow(line, prev, channels) {
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let filter = 0; filter <= 4; filter++) {
    const row = Buffer.alloc(line.length + 1);
    row[0] = filter;
    let score = 0;
    for (let i = 0; i < line.length; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const upLeft = i >= channels ? prev[i - channels] : 0;
      const value = (line[i] - predict(filter, left, prev[i], upLeft)) & 0xff;
      row[i + 1] = value;
      score += value < 128 ? value : 256 - value;
    }
    if (score < bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

/** The PNG filter predictors: None, Sub, Up, Average and Paeth. */
function predict(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      if (toLeft <= toUp && toLeft <= toUpLeft) return left;
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`Unknown PNG filter ${filter}`);
  }
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, data.length + 8)),
    data.length + 8,
  );
  return chunk;
}

/** Packs PNG images into an ICO file: a header, a directory, then the PNGs. */
function encodeIco(images) {
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2); // type 1: icon
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    directory[entry] = size % 256; // width; 0 means 256
    directory[entry + 1] = size % 256; // height
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([directory, ...images.map(({ png }) => png)]);
}

await main();

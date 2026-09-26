# LivTales brand

The product is **LivTales** (read "Live Tales"), and the repository, packages,
environment variables, CSS tokens, and code carry the same name. Database objects,
stored client keys, and the CloudBase services keep the earlier name Chronelle; the
list is in [Names that keep Chronelle](../docs/architecture.md#names-that-keep-chronelle).

This folder holds the brand's vector sources, the script that renders platform rasters
from them, and the font licence. The apps keep their own copies of the art they ship,
and tests hold those copies to the files here.

## The mark and the wordmark

- **Mark: Foam Crest.** An open book whose right page and three sail bands form one junk
  sail (帆); the left page is tinted. Mark files use a 100 × 100 frame, with the ink
  spanning 7 to 93.
- **Wordmark: LivTales.** Outfit 620, two-tone: "Liv" in the page colour, "Tales" in the
  ink. It ships as outlines in two paths (Liv, Tales), with no live text; recolour it by
  changing the two fills.
- **Lockups.** Horizontal (the main logo: mark beside the word), stacked (mark above the
  word), and app tile (the icon tile beside the word). The header logos are the
  horizontal lockup tuned to 118 × 32 px.

## Themes

| Theme               | Sources                                          | Status                                            |
| ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Night Voyage 夜航   | `icon/`, `logo/`, `social/` at the top of brand/ | Default. The web app and the Mini Program ship it |
| Polar Aurora 极光帆 | `themes/polar-aurora/{icon,logo,social}/`        | Backup. Same file names, not used by the apps     |

Polar Aurora is teal to ultramarine: Liv `#077A6E` and Tales `#13233F` on light
surfaces, `#4FE0C4` and `#EEF3FA` on `#1C1E24`, accent `#2159D4`. The rules in this
guide are Night Voyage's; Polar Aurora differs in a few places: its header logos are
119 × 32 with four paths, its stacked mark is 2.73 C tall, and its app tile is 2.8 C
with a gap of 0.3 × the tile. It has no `icon/maskable.svg`; the export composes one
from its Android layers.

To ship Polar Aurora instead, make it the top-level set (move Night Voyage to
`themes/night-voyage/` and update `DEFAULT_THEME` in `scripts/export.mjs`), then
update every app copy listed in [Updating the app copies](#updating-the-app-copies).
The web logo changes shape with it (four paths, new `--brand-*` tokens), and the brand
tests fail until each copy matches.

## Folder map

```text
brand/
  README.md             this guide
  OFL-outfit.txt        SIL Open Font License 1.1 for Outfit
  logo/                 marks, wordmarks, lockups, header logos
  icon/                 app icon art for each platform, favicon, avatar
  social/               Open Graph card and launch screens
  themes/polar-aurora/  the backup theme: icon/, logo/, social/
  scripts/export.mjs    raster export (pnpm brand:export)
  dist/<theme>/         export output, git-ignored
```

| File                                                            | Frame           | What it is                                                              |
| --------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| `logo/mark.svg`                                                 | 100 × 100       | Full-colour mark with gradients and a soft shadow                       |
| `logo/mark-light.svg`, `mark-dark.svg`                          | 100 × 100       | Flat mark for white and paper, and for `#1C1E24`                        |
| `logo/mark-mono-black.svg`, `mark-mono-white.svg`               | 100 × 100       | One-colour mark                                                         |
| `logo/wordmark-{light,dark,mono-black,mono-white}.svg`          | 500.99 × 104.55 | Word only                                                               |
| `logo/lockup-horizontal-{light,dark,mono-black,mono-white}.svg` | 786.24 × 210    | The main logo                                                           |
| `logo/lockup-stacked-{light,dark}.svg`                          | 500.99 × 448.7  | Mark centred above the word                                             |
| `logo/lockup-app-tile.svg`, `lockup-app-tile-dark.svg`          | 845.99 × 250    | App tile beside the word, for light and dark slides                     |
| `logo/header-logo-light.svg`, `header-logo-dark.svg`            | 118 × 32 px     | Horizontal lockup pixel-tuned for a 32 px header                        |
| `icon/app-icon.svg`                                             | 100 × 100       | Full-bleed square app tile: sky, aurora, the mark in white and aqua     |
| `icon/app-icon-small.svg`                                       | 100 × 100       | The app tile simplified for iOS and Android canvases of 60 px and below |
| `icon/app-icon-flat.svg`                                        | 100 × 100       | Flat tile for Windows 16 to 48: the favicon's tile and mark, square     |
| `icon/app-icon-flat-macos.svg`                                  | 100 × 100       | Flat tile for macOS 16 and 32: the favicon's mark on the sky            |
| `icon/pwa-icon.svg`                                             | 100 × 100       | The app tile with 22.4 % corners, for the PWA "any" icons               |
| `icon/app-icon-dark.svg`, `app-icon-tinted.svg`                 | 100 × 100       | iOS 18 dark and tinted appearances                                      |
| `icon/android-{background,foreground,monochrome}.svg`           | 150 (108 dp)    | Android adaptive icon layers                                            |
| `icon/maskable.svg`                                             | 100 × 100       | PWA maskable icon composed from the Android layers                      |
| `icon/macos-icon.svg`                                           | 1024 × 1024     | Big Sur tile (824 at 100, 100, radius 185) with its shadow              |
| `icon/wechat-avatar.svg`                                        | 100 × 100       | Mini Program avatar; WeChat crops it to a circle                        |
| `icon/favicon.svg`                                              | 100 × 100       | Flat tab icon, tuned for 16 px                                          |
| `social/og-image.svg`                                           | 1200 × 630      | Link preview card: the lockup on the night sky                          |
| `social/splash-light.svg`, `splash-dark.svg`                    | 1290 × 2796     | Launch screens on white and on night navy                               |

## Which file to use

| Scenario                                           | Use                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Web header, drawer, account, code, and error pages | `<BrandLogo/>` in `apps/web/components/brand-logo.tsx`: inline SVG of `logo/header-logo-light.svg`, coloured by `--brand-*` tokens |
| Browser tab                                        | `apps/web/app/icon.svg` (copy of `icon/favicon.svg`), with `apps/web/app/favicon.ico` (16, 32, 48) as the fallback                 |
| iOS home screen (web clip)                         | `apps/web/app/apple-icon.png`: 180 px, opaque; iOS rounds the corners                                                              |
| PWA install                                        | `apps/web/public/icons/pwa-icon.svg` (copy of `icon/pwa-icon.svg`) plus `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`    |
| Link previews                                      | `apps/web/app/opengraph-image.jpg` (1200 × 630) and `opengraph-image.alt.txt`                                                      |
| Mini Program lockup                                | The base64 data URIs in `apps/wechat/src/shell/brand.scss`, checked by `apps/wechat/test/brand-art.test.ts`                        |
| Mini Program avatar (upload)                       | `dist/night-voyage/wechat/avatar-512.png` (or `avatar-144.png`), uploaded on mp.weixin.qq.com                                      |
| Native iOS app                                     | `dist/<theme>/ios/`: `Contents.json` and the three 1024 PNGs form the single-size AppIcon set                                      |
| Native Android app                                 | `dist/<theme>/android/mipmap-*` into `res/`; `play-store-512.png` for the Play listing                                             |
| Native macOS app                                   | `dist/<theme>/macos/LivTales.icns`                                                                                                 |
| Native Windows app                                 | `dist/<theme>/windows/LivTales.ico`                                                                                                |
| Print, slides, press                               | `logo/lockup-horizontal-*.svg` (the main logo), `lockup-stacked-*.svg`, `lockup-app-tile*.svg`                                     |
| One colour, stamps, over photos                    | `logo/*-mono-black.svg` and `*-mono-white.svg`                                                                                     |
| Anything under 24 px                               | `icon/favicon.svg` or `logo/mark-mono-*.svg`, never a lockup                                                                       |

Match the file to the surface: `-light` on white and paper, `-dark` on `#1C1E24` or
darker, the tile art on the sky gradient or night navy, and mono on photos.

## Vector first

Use the SVG wherever the platform draws SVG: inline SVG in the web UI, the SVG favicon
and manifest icon, SVG data URIs in the Mini Program. Use rasters only where a platform
requires them: the apple-touch-icon, the PWA PNG icons, the `favicon.ico` fallback, the
Open Graph image, native app icon sets, and store or console uploads.

Never edit a raster by hand: change the SVG and export again. Never retype the name in
live text in place of the logo.

The apps keep copies because each builds from its own folder: the web image copies only
`apps/web` and two packages, and WXSS cannot load local files.

## Exporting rasters

```bash
pnpm exec playwright install chromium   # once
pnpm brand:export                       # Night Voyage into brand/dist/night-voyage/
pnpm brand:export --theme polar-aurora  # themes/polar-aurora into brand/dist/polar-aurora/
pnpm brand:export --web                 # also copy the web rasters into apps/web
pnpm brand:export --help
```

- Chromium from `@playwright/test` draws each SVG at its exact pixel size. Rounded
  tiles, insets, and shadows are applied in CSS. The script encodes PNG and ICO itself
  with `node:zlib` and has no other dependencies.
- Each run deletes and rewrites `brand/dist/<theme>/`, which is git-ignored.
- Opaque outputs are RGB PNGs without an alpha channel. If an opaque output's art
  leaves any pixel translucent, the run stops with an error naming the file.
- iOS and Android canvases of 60 px or less draw `icon/app-icon-small.svg`: iOS 40,
  58 and 60, and Android legacy mdpi. Desktop icons use flat art without the aurora,
  which smudges at taskbar and Finder sizes: Windows 16 to 48 draw
  `icon/app-icon-flat.svg`, and macOS 16 and 32 draw `icon/app-icon-flat-macos.svg`
  (on the Big Sur grid of `macos-icon.svg`, snapped to whole pixels), whose sky keeps
  the tile's edge on Finder's blue selection.
- The PWA "any" icons draw `icon/pwa-icon.svg`, the same rounded tile the web app
  serves as its SVG icon.
- The Open Graph card is a JPEG at quality 90. Its alt text is written without a final
  newline, because Next.js copies the file into `og:image:alt` as is.
- On macOS, `iconutil` builds `LivTales.icns` from the iconset. Elsewhere the step is
  skipped with a message, and the `.iconset` folder is still written.
- `--web` copies seven files from the chosen theme: `favicon.ico`, `apple-icon.png`,
  `opengraph-image.jpg` and `opengraph-image.alt.txt` into `apps/web/app/`, and the
  three PNGs into `apps/web/public/icons/`. It also writes
  `apps/web/app/brand-rasters.json`: the SHA-256 of each copy, of the sources it was
  drawn from, and of this script. Use it only with the theme the apps ship, or the
  PNG icons stop matching the SVG ones.
- A theme without `icon/maskable.svg` gets one composed from its Android layers (the
  background showing its central 72 dp, the foreground at 0.85 about the centre). The
  source used is written to `dist/<theme>/web/maskable.svg` for review.

| Folder     | Outputs                                                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/`     | `favicon.ico` (16, 32, 48), `apple-touch-icon.png` (180, opaque), `icon-192.png` and `icon-512.png` (tile with 22.4 % corners), `icon-maskable-512.png` (opaque), `maskable.svg`, `og-image.jpg`, `og-image.alt.txt`                                                                                        |
| `ios/`     | `AppIcon-1024.png` (opaque), `AppIcon-dark-1024.png`, `AppIcon-tinted-1024.png`, `Contents.json`, and legacy `AppIcon-{40,58,60,80,87,120,152,167,180}.png` (opaque)                                                                                                                                        |
| `android/` | `mipmap-{m,h,xh,xxh,xxxh}dpi/`: `ic_launcher_background.png` (opaque), `_foreground.png`, `_monochrome.png` (108 dp), and legacy `ic_launcher.png` and `ic_launcher_round.png` (48 dp, for minSdk below 26); `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`; `play-store-512.png` (opaque) |
| `wechat/`  | `avatar-512.png`, `avatar-144.png` (opaque)                                                                                                                                                                                                                                                                 |
| `macos/`   | `LivTales.iconset/` (16 to 1024 at 1x and 2x), `LivTales.icns`                                                                                                                                                                                                                                              |
| `windows/` | `LivTales.ico` (16, 24, 32, 48, 64, 128, 256; 8 % corners)                                                                                                                                                                                                                                                  |

The launch screens (`social/splash-*.svg`) and the Windows MSIX tile logos are not
exported.

## Updating the app copies

After changing a source in brand/:

1. Tab icon: copy `icon/favicon.svg` to `apps/web/app/icon.svg`.
2. PWA SVG icon: copy `icon/pwa-icon.svg` to `apps/web/public/icons/pwa-icon.svg`.
3. Web rasters: `pnpm brand:export --web`.
4. Web logo: `apps/web/components/brand-logo.tsx` carries the viewBox, group transforms,
   and path data of `logo/header-logo-light.svg`, one class per path. Each class's fill
   is a `--brand-*` token in `apps/web/app/tokens.css` drawn from the app palette's
   accent, canvas, and ink rather than the header logos' fills, so give a new part a
   token of its own there.
5. Mini Program: re-embed both header logos in `apps/wechat/src/shell/brand.scss`, each
   under its `// brand/logo/…svg` comment, the light one first and the dark one inside
   the `prefers-color-scheme: dark` rule:
   ```bash
   node -e "process.stdout.write(require('node:fs').readFileSync('brand/logo/header-logo-light.svg').toString('base64'))"
   ```
6. Run the brand tests below.

## Tests that keep the copies in sync

- `apps/web/test/brand-assets.test.ts`: `app/icon.svg` and `public/icons/pwa-icon.svg`
  are byte-identical to `icon/favicon.svg` and `icon/pwa-icon.svg`; `<BrandLogo/>` draws
  `header-logo-light.svg` exactly (the dark file has the same drawing), and each part's
  token is drawn from the palette; every manifest icon exists at its declared size and
  the maskable one is opaque; `favicon.ico` holds 16, 32 and 48; `apple-icon.png` is 180
  and opaque; the Open Graph image is 1200 × 630 with alt text naming LivTales; every
  raster the app serves, its sources, and `scripts/export.mjs` still have the digests
  in `app/brand-rasters.json`, and the "any" PNG icons were drawn from
  `icon/pwa-icon.svg`; the site metadata names LivTales.
- `apps/wechat/test/brand-art.test.ts`: every SVG data URI in the Mini Program's
  stylesheets is base64; the brand art is exactly the two header logos in
  `shell/brand.scss`, decoding byte for byte to the files here, as outlines only
  (`svg`, `title`, `g`, `path`); the dark art applies only under the dark colour scheme;
  the lockup names itself in text clipped out of sight, since Taro writes no aria
  attributes into WXML; the build keeps cssnano's SVGO pass off, so the package ships
  the art unchanged.
- `apps/wechat/test/page-titles.test.ts`: the window title and every static page title
  read LivTales or a catalog word.

```bash
pnpm --filter @livtales/web exec vitest run test/brand-assets.test.ts
pnpm --filter @livtales/wechat exec vitest run test/brand-art.test.ts test/page-titles.test.ts
```

The tests check the committed rasters' sizes and opacity, and that they are the last
export of the sources as they stand, not their pixels: always produce them with the
export script, and run `pnpm brand:export --web` again after changing a source they
are drawn from or the script.

## Geometry, clear space, and minimum sizes

These are the Night Voyage rules. **C** is the wordmark's cap height (the height of the L).

| Item               | Rule                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark           | Outfit (variable), `wght` 620, tracking −5/1000 em, `kern` and `liga` on, `ss01` off (single-storey a); one pair tweak: L–i −15/1000 em                 |
| Horizontal lockup  | Mark height 2.1 C; gap 0.38 × mark height (0.80 C), from the sail's ink edge to the L stem                                                              |
| Vertical alignment | The mark's optical centre (y 58 of its frame) sits on the cap midline: the book drops below the baseline like a hull, the sail rises above the cap line |
| Stacked lockup     | Mark height 1.6 × one third of the word width (2.67 C), centred over the word; gap from the book to the cap top 0.80 C                                  |
| App tile lockup    | Tile 2.5 C, corner radius 22.4 % of the tile, centred on the cap midline; gap 0.38 × tile (0.95 C)                                                      |

**Clear space.** Lockups: 0.5 × mark height on every side (about 1 C; 16 px on the 32 px
header logo). Mark alone and app tile: 0.25 × their height on every side. Keep text,
edges, and other logos out of it; photos and busy art too, unless you use the
one-colour version.

| Asset                                     | Minimum                       | Note                                                                                                       |
| ----------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Horizontal lockup                         | 20 px tall (cap about 9.5 px) | Recommended web header: 32 px (cap 15 px, level with 14–16 px navigation text)                             |
| Stacked lockup                            | 48 px tall                    |                                                                                                            |
| App tile lockup                           | 24 px tall                    |                                                                                                            |
| Wordmark alone                            | 9 px cap                      | The viewBox is 1.0455 C tall (ascender to baseline overshoot): for a 16 px cap, set the height to 16.73 px |
| Mark (`mark`, `mark-light`, `mark-dark`)  | 24 px                         |                                                                                                            |
| Tab icon, favicon, app icons, under 24 px | 16 px                         | The mark alone from `icon/favicon.svg` or `logo/mark-mono-*.svg`, and the app icon sets; never a lockup    |

- **Web header.** `logo/header-logo-*.svg` are 118 × 32 px: cap 15 px, baseline at
  26 px, so the cap top and baseline fall on whole pixels at 1×, 1.5×, 2×, and 3×. The
  web app draws the logo a step quieter, at 26 px (cap about 12 px), in the sidebar,
  the phone drawer, and the not-found and error pages, and at 40 px on the account
  screens and the code page (`--brand-height`).
- **Mini Program.** The lockup at 28 to 32 px in the navigation bar, or the mark alone
  beside the system title. The sidebar head draws it at 118 × 32 px; entry pages draw it
  at 266 × 72rpx.

## Colours (Night Voyage)

| Hex                                                      | Role                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `#0A7C94`                                                | **Liv** on white and paper (4.86:1 on white, 4.24:1 on paper)             |
| `#141B34`                                                | **Tales** on white and paper; one-colour ink on light surfaces (17.0:1)   |
| `#5FDDE8`                                                | **Liv** on near-black `#1C1E24` (10.3:1); page colour in `mark-dark`      |
| `#EAF1FF`                                                | **Tales** on near-black (14.7:1); one-colour ink on dark surfaces         |
| `#8FF0F0` / `#FFFFFF`                                    | **Liv** / **Tales** on the night sky (Open Graph card, dark splash)       |
| `#10A3C2` · `#2A78E4` · `#1D3A9E`                        | `mark-light`: left page · upper two bands · lower band and right page     |
| `#5FDDE8` · `#A4DAFF` · `#7FB4FF`                        | `mark-dark`: left page · upper two bands · lower band and right page      |
| `#27A6EC` → `#2358D6` → `#1A3494`; `#5FE0EA` → `#14AEC8` | `mark.svg`: sail gradient; left-page gradient                             |
| `#35B8EE` → `#2358D6` → `#1B3598` → `#13296F`            | Tile sky (app icon, Open Graph card)                                      |
| `#5EE6F5`, `#8CFFD6`, `#7FF3FF`, `#62D6FF`               | Ice glow and aurora ribbon on the tile                                    |
| `#2459D8`                                                | Flat favicon tile                                                         |
| `#13296F`                                                | Night navy: dark splash and marketing surfaces                            |
| `#FFFFFF` · `#F5EFE4` · `#1C1E24`                        | Surfaces: white, paper, near-black                                        |
| `#2358D6` (light) / `#7FB4FF` (dark)                     | Accent for buttons and links on brand surfaces; **not** a wordmark colour |

The one-colour files use `#000000` and `#FFFFFF`; the theme ink (`#141B34` / `#EAF1FF`)
or `currentColor` may replace them. The web app draws the logo in the link colour in
forced-colours mode, as the one-colour version does.

The web app's in-app logo is the one exception to these colours: it takes the chosen
palette's accent, canvas, and ink (`--brand-*` in `apps/web/app/tokens.css`), so it
matches the theme the user picks. The favicon, app icons, link preview, and Mini Program
art keep the colours above.

**Do:** keep Liv in the page colour and Tales in the ink, the page colour first; scale
proportionally; keep the clear space.

**Don't:** recolour Liv to the accent blue, swap the two tones, or set the whole word in
the page colour; retype the name, add tracking, or change weight or font; change the
mark's geometry, the lockup ratios, or the gap; add outlines, glows, or shadows to the
flat marks; put a light-surface file on a dark surface or the reverse; put the colour
lockup over a busy photo; use a lockup under 20 px tall or as a favicon, tab icon, or
app icon.

## Typeface and licence

The wordmark is set in Outfit, © 2021 The Outfit Project Authors, under the SIL Open
Font License 1.1; the full text is in [`OFL-outfit.txt`](OFL-outfit.txt). The logo files
are outlines, so displaying them needs no font, and the apps do not ship it. Use the font
only to set new brand text, and keep the licence with any copy of the font you share. The
OFL allows bundling and embedding the font but not selling it on its own.

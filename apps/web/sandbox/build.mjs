import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appearanceBootstrap } from "../lib/appearance-preference.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const overrides = new Map([
  ["api-context", "api-context.tsx"],
  ["auth-session", "auth-session.tsx"],
  ["use-event-view", "router.tsx"],
]);
const result = await build({
  absWorkingDir: resolve(directory, ".."),
  entryPoints: [resolve(directory, "main.tsx")],
  bundle: true,
  write: false,
  outfile: "sandbox.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  legalComments: "inline",
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "next/link": resolve(directory, "router.tsx"),
    "next/navigation": resolve(directory, "router.tsx"),
  },
  plugins: [
    {
      name: "sandbox-boundaries",
      setup(build) {
        build.onResolve(
          { filter: /(?:api-context|auth-session|use-event-view)$/ },
          ({ path }) => {
            const name = path.split("/").at(-1);
            const replacement = overrides.get(name);
            return replacement
              ? { path: resolve(directory, replacement) }
              : undefined;
          },
        );
      },
    },
  ],
});
const script = result.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replace(/<\/script/gi, "<\\/script");
const css = result.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/<\/style/gi, "<\\/style");
const hash = createHash("sha256").update(script).digest("base64");
const appearanceHash = createHash("sha256")
  .update(appearanceBootstrap)
  .digest("base64");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}' 'sha256-${appearanceHash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>Chronelle design sandbox</title><style>${css}</style><script>${appearanceBootstrap}</script></head><body><div id="sandbox-root"></div><script>${script}</script></body></html>`;
const output = resolve(directory, "../../../.chronelle/sandbox");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "chronelle.html"), html);
await writeFile(
  resolve(output, "bundle-inputs.json"),
  JSON.stringify(Object.keys(result.metafile.inputs), null, 2),
);
console.log(
  "Browser-only sandbox: .chronelle/sandbox/chronelle.html (open directly in a browser)",
);

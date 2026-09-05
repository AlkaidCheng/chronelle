import { cp, mkdir } from "node:fs/promises";

const standaloneAppDirectory = new URL(
  "../.next/standalone/apps/web/",
  import.meta.url,
);
const standaloneNextDirectory = new URL(".next/", standaloneAppDirectory);

await mkdir(standaloneNextDirectory, { recursive: true });
await cp(
  new URL("../.next/static/", import.meta.url),
  new URL("static/", standaloneNextDirectory),
  {
    force: true,
    recursive: true,
  },
);

await import(new URL("server.js", standaloneAppDirectory).href);

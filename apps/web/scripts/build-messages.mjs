// Assembles one catalog per locale, apps/web/messages/<locale>.json, from
// the namespace files under apps/web/messages/<locale>/. The assembled
// files are build outputs: the namespace files are the source of truth, so
// two changes never edit the same file unless they touch the same namespace.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const messages = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "messages",
);

async function namespaceFiles(locale) {
  const names = (await readdir(join(messages, locale))).filter((name) =>
    name.endsWith(".json"),
  );
  return names.sort();
}

async function readNamespace(locale, file) {
  const path = join(messages, locale, file);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${path}: the top level must be an object.`);
  return parsed;
}

const locales = (await readdir(messages, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (locales.length === 0) throw new Error(`${messages}: no locale directory.`);

const files = new Map(
  await Promise.all(
    locales.map(async (locale) => [locale, await namespaceFiles(locale)]),
  ),
);
const [reference, ...others] = locales;
for (const locale of others) {
  const missing = files
    .get(reference)
    .filter((f) => !files.get(locale).includes(f));
  const extra = files
    .get(locale)
    .filter((f) => !files.get(reference).includes(f));
  if (missing.length > 0 || extra.length > 0)
    throw new Error(
      `${locale} and ${reference} carry different namespaces` +
        (missing.length > 0
          ? `; missing in ${locale}: ${missing.join(", ")}`
          : "") +
        (extra.length > 0 ? `; only in ${locale}: ${extra.join(", ")}` : "") +
        ".",
    );
}

await mkdir(messages, { recursive: true });
for (const locale of locales) {
  const catalog = {};
  for (const file of files.get(locale))
    catalog[file.slice(0, -".json".length)] = await readNamespace(locale, file);
  await writeFile(
    join(messages, `${locale}.json`),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
}

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

assert.equal(process.getuid(), 1000, "The runtime must use the node user.");
function* walkFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}
const developmentPackages = new Set([
  "@biomejs/biome",
  "@playwright/test",
  "prettier",
  "tsx",
  "typescript",
  "vitest",
]);
let workspacePackages = 0;
let fileCount = 0;
for (const path of walkFiles("/app")) {
  fileCount += 1;
  assert(
    !/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.codex|\.agents|\.claude)(?:\/|$)/u.test(
      path,
    ),
    `Private build input in runtime: ${path}`,
  );
  if (!path.endsWith("/package.json")) continue;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert(
    !developmentPackages.has(manifest.name),
    `Development package: ${manifest.name}`,
  );
  if (!manifest.name?.startsWith("@livtales/")) continue;
  workspacePackages += 1;
  for (const name of ["src", "test", "e2e", "Dockerfile", "tsconfig.json"]) {
    assert(
      !existsSync(join(dirname(path), name)),
      `Build input in ${manifest.name}: ${name}`,
    );
  }
}
assert(workspacePackages > 0);
if (existsSync("/app/dist/server.js")) {
  assert(
    existsSync("/app/dist/benchmark-cloudbase.js"),
    "CloudBase benchmark entry point is missing.",
  );
}
assert.equal(statSync("/app").uid, 0, "Application code stays root-owned.");
console.log(
  `Runtime contents checked: ${workspacePackages} workspace packages, ${fileCount} files.`,
);

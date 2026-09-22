import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const bundleBudgets = {
  main: 1_500_000,
  subpackage: 1_500_000,
  total: 15_000_000,
} as const;

export interface BundleStats {
  readonly mainBytes: number;
  readonly subpackages: ReadonlyArray<{
    readonly root: string;
    readonly bytes: number;
  }>;
  readonly totalBytes: number;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(root, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Bundle output must not contain symbolic links: ${candidate}`,
        );
      }
      return entry.isDirectory() ? listFiles(candidate) : [candidate];
    }),
  );
  return nested.flat();
}

function isWithin(relativeFile: string, root: string): boolean {
  return relativeFile === root || relativeFile.startsWith(`${root}/`);
}

function normalizeSubpackageRoot(root: unknown): string {
  if (typeof root !== "string") {
    throw new Error(
      "Every Mini Program subpackage must declare a safe relative root.",
    );
  }
  const normalized = root.replaceAll("\\", "/").replace(/\/+$/u, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      "Every Mini Program subpackage must declare a safe relative root.",
    );
  }
  return normalized;
}

export async function collectBundleStats(
  outputRoot: string,
): Promise<BundleStats> {
  const appConfig = JSON.parse(
    await readFile(path.join(outputRoot, "app.json"), "utf8"),
  ) as {
    subPackages?: Array<{ root?: unknown }>;
  };
  const subpackageRoots = (appConfig.subPackages ?? []).map(({ root }) =>
    normalizeSubpackageRoot(root),
  );
  const files = await listFiles(outputRoot);
  const fileSizes = await Promise.all(
    files.map(async (file) => ({
      bytes: (await lstat(file)).size,
      relative: path.relative(outputRoot, file).split(path.sep).join("/"),
    })),
  );
  const subpackages = subpackageRoots.map((root) => ({
    root,
    bytes: fileSizes
      .filter(({ relative }) => isWithin(relative, root))
      .reduce((total, { bytes }) => total + bytes, 0),
  }));
  const totalBytes = fileSizes.reduce((total, { bytes }) => total + bytes, 0);
  const subpackageBytes = subpackages.reduce(
    (total, { bytes }) => total + bytes,
    0,
  );

  return {
    mainBytes: totalBytes - subpackageBytes,
    subpackages,
    totalBytes,
  };
}

export function assertBundleBudgets(stats: BundleStats): void {
  const failures: string[] = [];
  if (stats.mainBytes > bundleBudgets.main) {
    failures.push(
      `main package ${stats.mainBytes} > ${bundleBudgets.main} bytes`,
    );
  }
  if (stats.totalBytes > bundleBudgets.total) {
    failures.push(
      `total package ${stats.totalBytes} > ${bundleBudgets.total} bytes`,
    );
  }
  for (const subpackage of stats.subpackages) {
    if (subpackage.bytes > bundleBudgets.subpackage) {
      failures.push(
        `subpackage ${subpackage.root} ${subpackage.bytes} > ${bundleBudgets.subpackage} bytes`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`WeChat bundle budget exceeded:\n${failures.join("\n")}`);
  }
}

async function main(): Promise<void> {
  const outputRoot = path.resolve(import.meta.dirname, "../dist/weapp");
  const stats = await collectBundleStats(outputRoot);
  assertBundleBudgets(stats);
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify({ budgets: bundleBudgets, ...stats }, undefined, 2),
    );
    return;
  }
  console.log(
    `WeChat bundle: main ${stats.mainBytes} bytes; total ${stats.totalBytes} bytes; ${stats.subpackages.length} subpackages`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}

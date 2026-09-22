import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertBundleBudgets,
  bundleBudgets,
  collectBundleStats,
} from "../scripts/report-bundle";

const temporaryDirectories: string[] = [];

async function createBundle(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "chronelle-wechat-bundle-"),
  );
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Mini Program bundle report", () => {
  it("separates main-package and subpackage bytes", async () => {
    const root = await createBundle();
    await mkdir(path.join(root, "features/events"), { recursive: true });
    await writeFile(
      path.join(root, "app.json"),
      '{"subPackages":[{"root":"features/events"}]}',
    );
    await writeFile(path.join(root, "app.js"), "main");
    await writeFile(path.join(root, "features/events/index.js"), "feature");

    await expect(collectBundleStats(root)).resolves.toEqual({
      mainBytes: 48,
      subpackages: [{ root: "features/events", bytes: 7 }],
      totalBytes: 55,
    });
  });

  it("fails closed when a package exceeds its budget", () => {
    expect(() =>
      assertBundleBudgets({
        mainBytes: bundleBudgets.main + 1,
        subpackages: [],
        totalBytes: bundleBudgets.main + 1,
      }),
    ).toThrow("main package");
  });

  it("accepts dotted names but rejects roots outside the bundle", async () => {
    const validRoot = await createBundle();
    await mkdir(path.join(validRoot, "features/events..archive"), {
      recursive: true,
    });
    await writeFile(
      path.join(validRoot, "app.json"),
      '{"subPackages":[{"root":"features/events..archive/"}]}',
    );
    await writeFile(
      path.join(validRoot, "features/events..archive/index.js"),
      "feature",
    );
    await expect(collectBundleStats(validRoot)).resolves.toMatchObject({
      subpackages: [{ root: "features/events..archive", bytes: 7 }],
    });

    const invalidRoot = await createBundle();
    await writeFile(
      path.join(invalidRoot, "app.json"),
      '{"subPackages":[{"root":"features/../outside"}]}',
    );
    await expect(collectBundleStats(invalidRoot)).rejects.toThrow(
      "safe relative root",
    );
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverMigrations } from "../src/migrations.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("discoverMigrations", () => {
  it("returns ordered SQL migrations and ignores unrelated files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "livtales-migrations-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n"),
      writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n"),
      writeFile(join(directory, "README.md"), "Migration notes\n"),
    ]);

    const migrations = await discoverMigrations(directory);

    expect(migrations.map((migration) => migration.filename)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

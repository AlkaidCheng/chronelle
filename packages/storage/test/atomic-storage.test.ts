import { createHash } from "node:crypto";
import { link, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LocalFilesystemStorageProvider,
  StorageObjectConflictError,
  StorageObjectUnavailableError,
  UnsafeStorageKeyError,
  resolveStoragePath,
} from "../src/index.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    link: vi.fn(filesystem.link),
    writeFile: vi.fn(filesystem.writeFile),
  };
});

const filesystem =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const prefix = "workspaces/workspace/documents";
const key = `${prefix}/document`;
const bytes = new TextEncoder().encode("complete private document");
function metadata(content: Uint8Array) {
  return {
    checksumSha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
  };
}
const expected = metadata(bytes);

describe("atomic local object publication", () => {
  let root: string;
  let provider: LocalFilesystemStorageProvider;

  async function collectInventory() {
    const entries = [];
    for await (const entry of provider.listObjects(
      prefix,
      new AbortController().signal,
    ))
      entries.push(entry);
    return entries;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "livtales-publication-"));
    provider = new LocalFilesystemStorageProvider({ root });
  });

  afterEach(async () => {
    vi.mocked(writeFile).mockReset();
    vi.mocked(link).mockReset();
    await rm(root, { force: true, recursive: true });
  });

  it("keeps incomplete writes unavailable to readers", async () => {
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    vi.mocked(writeFile).mockImplementationOnce(
      async (path, content, options) => {
        await filesystem.writeFile(path, bytes.subarray(0, 5), options);
        started.resolve();
        await resume.promise;
        await filesystem.writeFile(path, content);
      },
    );
    const pending = provider.writeObject(key, bytes, expected);
    try {
      await started.promise;
      await expect(provider.readObject(key)).rejects.toBeInstanceOf(
        StorageObjectUnavailableError,
      );
      const stagedPath = String(vi.mocked(writeFile).mock.calls[0]?.[0]);
      expect((await filesystem.stat(dirname(stagedPath))).mode & 0o777).toBe(
        0o700,
      );
      expect((await filesystem.stat(stagedPath)).mode & 0o777).toBe(0o600);
      await expect(
        provider.readObject(relative(root, stagedPath)),
      ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
      await expect(collectInventory()).resolves.toEqual([
        {
          storageKey: relative(root, dirname(stagedPath)),
          kind: "unsupported",
        },
      ]);
    } finally {
      resume.resolve();
      await pending;
    }
    await expect(provider.inspectObject(key)).resolves.toEqual(expected);
    await expect(collectInventory()).resolves.toEqual([
      { storageKey: key, kind: "file" },
    ]);
    expect(vi.mocked(writeFile).mock.calls[0]?.[2]).toMatchObject({
      flush: true,
    });
  });

  it("reports publication links as unsupported until owned staging cleanup completes", async () => {
    const published = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    vi.mocked(link).mockImplementationOnce(async (source, destination) => {
      await filesystem.link(source, destination);
      published.resolve();
      await resume.promise;
    });
    const pending = provider.writeObject(key, bytes, expected);
    try {
      await published.promise;
      await expect(provider.inspectObject(key)).resolves.toEqual(expected);
      const entries = await collectInventory();
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual({ storageKey: key, kind: "unsupported" });
      expect(entries.every((entry) => entry.kind === "unsupported")).toBe(true);
    } finally {
      resume.resolve();
      await pending;
    }
    await expect(collectInventory()).resolves.toEqual([
      { storageKey: key, kind: "file" },
    ]);
  });

  it("retains abandoned publication links after a matching retry", async () => {
    const objectPath = resolveStoragePath(root, key);
    const abandonedDirectory = join(dirname(objectPath), ".upload-abandoned");
    const abandonedPath = join(abandonedDirectory, "content");
    await filesystem.mkdir(abandonedDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await filesystem.writeFile(abandonedPath, bytes, { mode: 0o600 });
    await filesystem.link(abandonedPath, objectPath);

    await provider.writeObject(key, bytes, expected);

    await expect(provider.inspectObject(key)).resolves.toEqual(expected);
    expect(await filesystem.readFile(abandonedPath)).toEqual(
      Buffer.from(bytes),
    );
    expect((await filesystem.stat(objectPath)).nlink).toBe(2);
    const entries = await collectInventory();
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        { storageKey: key, kind: "unsupported" },
        {
          storageKey: relative(root, abandonedDirectory),
          kind: "unsupported",
        },
      ]),
    );
  });

  it("allows a clean retry after a write fails partway through", async () => {
    const failure = new Error("Interrupted filesystem write");
    vi.mocked(writeFile).mockImplementationOnce(
      async (path, _content, options) => {
        await filesystem.writeFile(path, bytes.subarray(0, 5), options);
        throw failure;
      },
    );
    await expect(provider.writeObject(key, bytes, expected)).rejects.toBe(
      failure,
    );
    await expect(provider.inspectObject(key)).rejects.toBeInstanceOf(
      StorageObjectUnavailableError,
    );
    expect(await readdir(dirname(resolveStoragePath(root, key)))).toEqual([]);
    await provider.writeObject(key, bytes, expected);
    await expect(provider.inspectObject(key)).resolves.toEqual(expected);
  });

  it("preserves published content when another upload fails", async () => {
    await provider.writeObject(key, bytes, expected);
    vi.mocked(writeFile).mockImplementationOnce(
      async (path, _content, options) => {
        await filesystem.writeFile(path, bytes.subarray(0, 5), options);
        throw new Error("Interrupted filesystem write");
      },
    );
    await expect(provider.writeObject(key, bytes, expected)).rejects.toThrow(
      "Interrupted filesystem write",
    );
    await expect(provider.inspectObject(key)).resolves.toEqual(expected);
  });

  it("accepts concurrent matching retries without retaining staging files", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        new LocalFilesystemStorageProvider({ root }).writeObject(
          key,
          bytes,
          expected,
        ),
      ),
    );
    await expect(provider.inspectObject(key)).resolves.toEqual(expected);
    expect(await readdir(dirname(resolveStoragePath(root, key)))).toEqual([
      "document",
    ]);
  });

  it.each([bytes.byteLength, bytes.byteLength + 1])(
    "rejects a concurrent content conflict of size %s without replacing the winner",
    async (length) => {
      const competingBytes = new Uint8Array(length).fill(65);
      const results = await Promise.allSettled([
        provider.writeObject(key, bytes, expected),
        provider.writeObject(key, competingBytes, metadata(competingBytes)),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.reason).toBeInstanceOf(StorageObjectConflictError);
      const stored = await provider.inspectObject(key);
      expect([expected, metadata(competingBytes)]).toContainEqual(stored);
      expect(await readdir(dirname(resolveStoragePath(root, key)))).toEqual([
        "document",
      ]);
    },
  );

  it.each(["EACCES", "EXDEV", "ENOSPC"])(
    "fails closed when publication fails with %s",
    async (code) => {
      const failure = Object.assign(new Error("Publication failed"), { code });
      vi.mocked(link).mockRejectedValueOnce(failure);
      await expect(provider.writeObject(key, bytes, expected)).rejects.toBe(
        failure,
      );
      await expect(provider.readObject(key)).rejects.toBeInstanceOf(
        StorageObjectUnavailableError,
      );
      expect(await readdir(dirname(resolveStoragePath(root, key)))).toEqual([]);
      await provider.writeObject(key, bytes, expected);
      await expect(provider.inspectObject(key)).resolves.toEqual(expected);
    },
  );

  it("preserves abandoned staging files without making them addressable", async () => {
    const directory = dirname(resolveStoragePath(root, key));
    const abandonedDirectory = join(directory, ".upload-abandoned");
    await filesystem.mkdir(abandonedDirectory, {
      recursive: true,
      mode: 0o700,
    });
    const abandonedPath = join(abandonedDirectory, "content");
    await filesystem.writeFile(abandonedPath, bytes.subarray(0, 5), {
      mode: 0o600,
    });
    await provider.writeObject(key, bytes, expected);
    await expect(provider.inspectObject(key)).resolves.toEqual(expected);
    expect(await filesystem.readFile(abandonedPath)).toEqual(
      Buffer.from(bytes.subarray(0, 5)),
    );
    await expect(
      provider.readObject(relative(root, abandonedPath)),
    ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
  });

  it("cleans its staging directory when writing fails before creating a file", async () => {
    const failure = new Error("Write unavailable");
    vi.mocked(writeFile).mockRejectedValueOnce(failure);
    await expect(provider.writeObject(key, bytes, expected)).rejects.toBe(
      failure,
    );
    expect(await readdir(dirname(resolveStoragePath(root, key)))).toEqual([]);
  });

  it("publishes an empty file with private permissions", async () => {
    const empty = new Uint8Array();
    await provider.writeObject(key, empty, metadata(empty));
    await expect(provider.inspectObject(key)).resolves.toEqual(metadata(empty));
    const path = resolveStoragePath(root, key);
    expect((await filesystem.stat(path)).mode & 0o777).toBe(0o600);
    expect((await filesystem.stat(dirname(path))).mode & 0o777).toBe(0o700);
  });
});

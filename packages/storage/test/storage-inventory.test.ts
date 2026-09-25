import {
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalFilesystemStorageProvider,
  StorageInventoryUnavailableError,
  UnsafeStorageKeyError,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "livtales-inventory-"));
  roots.push(root);
  return { root, provider: new LocalFilesystemStorageProvider({ root }) };
}

async function collect(
  provider: LocalFilesystemStorageProvider,
  prefix = "documents",
  signal = new AbortController().signal,
) {
  const entries = [];
  for await (const entry of provider.listObjects(prefix, signal))
    entries.push(entry);
  return entries;
}

describe("local storage inventory", () => {
  it("rejects a directory replaced during enumeration", async () => {
    const { root, provider } = await fixture();
    await mkdir(join(root, "documents"));
    await writeFile(join(root, "documents/file"), "content");
    const iterator = provider
      .listObjects("documents", new AbortController().signal)
      [Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await rename(join(root, "documents"), join(root, "retained-documents"));
    await mkdir(join(root, "documents"));
    await expect(iterator.next()).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
  });
  it("reports an absent prefix as empty without creating it", async () => {
    const { provider } = await fixture();
    await expect(collect(provider)).resolves.toEqual([]);
    await expect(collect(provider)).resolves.toEqual([]);
  });

  it("lists only immediate entries and treats links and directories as unsupported", async () => {
    const { root, provider } = await fixture();
    await mkdir(join(root, "documents/nested"), { recursive: true });
    await writeFile(join(root, "documents/file"), new Uint8Array([0, 255]));
    await writeFile(join(root, "documents/nested/hidden"), "nested");
    await writeFile(join(root, "outside"), "outside");
    await symlink(join(root, "outside"), join(root, "documents/link"));
    await symlink(root, join(root, "documents/directory-link"));
    await link(join(root, "outside"), join(root, "documents/hard-link"));
    expect(
      (await collect(provider)).sort((left, right) =>
        left.storageKey.localeCompare(right.storageKey),
      ),
    ).toEqual([
      { storageKey: "documents/directory-link", kind: "unsupported" },
      { storageKey: "documents/file", kind: "file" },
      { storageKey: "documents/hard-link", kind: "unsupported" },
      { storageKey: "documents/link", kind: "unsupported" },
      { storageKey: "documents/nested", kind: "unsupported" },
    ]);
  });

  it("rejects unsafe keys, missing roots, and symlinked ancestors", async () => {
    const { root, provider } = await fixture();
    await expect(collect(provider, "../outside")).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    );
    await expect(
      collect(
        new LocalFilesystemStorageProvider({ root: join(root, "missing") }),
      ),
    ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
    await mkdir(join(root, "target/documents"), { recursive: true });
    await symlink(join(root, "target"), join(root, "alias"));
    await expect(
      collect(
        new LocalFilesystemStorageProvider({ root: join(root, "alias") }),
      ),
    ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
    await expect(collect(provider, "alias/documents")).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
  });

  it("checks cancellation and releases the iterator when the consumer stops", async () => {
    const { root, provider } = await fixture();
    await mkdir(join(root, "documents"));
    await writeFile(join(root, "documents/file"), "content");
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(provider, "documents", controller.signal),
    ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
    for await (const entry of provider.listObjects(
      "documents",
      new AbortController().signal,
    )) {
      expect(entry.kind).toBe("file");
      break;
    }
    await expect(collect(provider)).resolves.toHaveLength(1);
  });
});

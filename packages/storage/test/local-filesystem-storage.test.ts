import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalFilesystemStorageProvider,
  StorageObjectConflictError,
  UnsafeStorageKeyError,
  resolveStoragePath,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createProvider() {
  const root = await mkdtemp(join(tmpdir(), "livtales-storage-"));
  temporaryDirectories.push(root);
  return new LocalFilesystemStorageProvider({ root });
}

describe("LocalFilesystemStorageProvider", () => {
  it("stores private bytes and returns opaque transfer paths", async () => {
    const provider = await createProvider();
    const bytes = new TextEncoder().encode("ticket content");
    const expected = {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
    };

    const upload = await provider.createUploadAuthorization({
      ...expected,
      credential: "opaque-upload-token",
      expiresAt: new Date("2026-10-15T16:05:00Z"),
      mimeType: "text/plain",
      storageKey:
        "workspaces/00000000-0000-7000-8000-000000000001/documents/00000000-0000-7000-8000-000000000002",
    });
    expect(upload).toMatchObject({
      method: "PUT",
      url: "/api/document-transfers/upload/opaque-upload-token",
    });

    await provider.writeObject(
      "workspaces/00000000-0000-7000-8000-000000000001/documents/00000000-0000-7000-8000-000000000002",
      bytes,
      expected,
    );
    await expect(
      provider.inspectObject(
        "workspaces/00000000-0000-7000-8000-000000000001/documents/00000000-0000-7000-8000-000000000002",
      ),
    ).resolves.toEqual(expected);
  });

  it("rejects traversal and conflicting writes", async () => {
    const provider = await createProvider();
    expect(() => resolveStoragePath("/tmp/storage", "../secret")).toThrow(
      UnsafeStorageKeyError,
    );
    expect(() =>
      resolveStoragePath("/tmp/storage", "safe/../../secret"),
    ).toThrow(UnsafeStorageKeyError);

    const key = "workspaces/workspace/documents/document";
    const first = new TextEncoder().encode("first");
    await provider.writeObject(key, first, {
      checksumSha256: createHash("sha256").update(first).digest("hex"),
      sizeBytes: first.byteLength,
    });
    const second = new TextEncoder().encode("second");
    await expect(
      provider.writeObject(key, second, {
        checksumSha256: createHash("sha256").update(second).digest("hex"),
        sizeBytes: second.byteLength,
      }),
    ).rejects.toBeInstanceOf(StorageObjectConflictError);
  });
});

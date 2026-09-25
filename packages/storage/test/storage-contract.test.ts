import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalFilesystemStorageProvider,
  StorageObjectUnavailableError,
  UnsafeStorageKeyError,
  type StorageProvider,
} from "../src/index.js";
import { createCosFixture } from "./cos-fixture.js";

const roots: string[] = [];
const key = "workspaces/workspace/documents/document";
const metadata = (bytes: Uint8Array) => ({
  sizeBytes: bytes.byteLength,
  checksumSha256: createHash("sha256").update(bytes).digest("hex"),
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type Fixture = {
  provider: StorageProvider;
  seed: (bytes: Uint8Array) => Promise<void>;
};
const factories: Record<string, () => Promise<Fixture>> = {
  local: async () => {
    const root = await mkdtemp(join(tmpdir(), "livtales-contract-"));
    roots.push(root);
    const provider = new LocalFilesystemStorageProvider({ root });
    return {
      provider,
      seed: (bytes) => provider.writeObject(key, bytes, metadata(bytes)),
    };
  },
  cos: async () => {
    const fixture = createCosFixture();
    return {
      provider: fixture.provider,
      seed: async (bytes) => {
        fixture.content.set(key, bytes);
      },
    };
  },
};

for (const [name, createFixture] of Object.entries(factories)) {
  describe(`${name} storage contract`, () => {
    it.each([new Uint8Array(), new Uint8Array([0, 255, 128, 10, 32])])(
      "inspects actual binary bytes",
      async (bytes) => {
        const { provider, seed } = await createFixture();
        await seed(bytes);
        await expect(provider.inspectObject(key)).resolves.toEqual(
          metadata(bytes),
        );
      },
    );

    it("reports unavailable objects without exposing their storage location", async () => {
      const { provider } = await createFixture();
      await expect(provider.inspectObject(key)).rejects.toBeInstanceOf(
        StorageObjectUnavailableError,
      );
    });

    it("issues expiring upload and download capabilities", async () => {
      const { provider } = await createFixture();
      const expiresAt = new Date(Date.now() + 60_000);
      const common = {
        storageKey: key,
        credential: "opaque-token",
        expiresAt,
        mimeType: "text/plain",
      };
      const upload = await provider.createUploadAuthorization({
        ...common,
        ...metadata(new Uint8Array()),
      });
      const download = await provider.createDownloadAuthorization({
        ...common,
        originalFilename: "document.txt",
      });
      expect(upload.method).toBe("PUT");
      expect(download.method).toBe("GET");
      for (const transfer of [upload, download]) {
        expect(transfer.expiresAt.getTime()).toBeLessThanOrEqual(
          expiresAt.getTime(),
        );
        expect(transfer.expiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(transfer.headers).not.toHaveProperty("authorization");
      }
    });

    it.each([
      "",
      "/absolute",
      "../secret",
      "safe/../secret",
      "safe/./file",
      "safe//file",
      "safe/",
      "safe\\file",
      "safe/%2e%2e/file",
      "safe/file?query",
      "safe/file#fragment",
      "safe/.staging",
    ])("rejects unsafe key %j on every operation", async (storageKey) => {
      const { provider } = await createFixture();
      const common = {
        storageKey,
        credential: "opaque-token",
        expiresAt: new Date(Date.now() + 60_000),
        mimeType: "text/plain",
      };
      await expect(provider.inspectObject(storageKey)).rejects.toBeInstanceOf(
        UnsafeStorageKeyError,
      );
      await expect(
        provider.createUploadAuthorization({
          ...common,
          ...metadata(new Uint8Array()),
        }),
      ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
      await expect(
        provider.createDownloadAuthorization({
          ...common,
          originalFilename: "file",
        }),
      ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
    });
  });
}

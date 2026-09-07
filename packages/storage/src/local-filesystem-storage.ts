import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  StorageObjectConflictError,
  StorageObjectUnavailableError,
  StorageInventoryUnavailableError,
  UnsafeStorageKeyError,
} from "./errors.js";
import type {
  DownloadAuthorizationInput,
  StorageTransferProvider,
  StoredObjectMetadata,
  StorageTransferAuthorization,
  UploadAuthorizationInput,
  StorageInventoryEntry,
} from "./types.js";

const safeKeySegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function resolveStoragePath(root: string, storageKey: string): string {
  const segments = storageKey.split("/");
  if (
    storageKey.length === 0 ||
    isAbsolute(storageKey) ||
    storageKey.includes("\\") ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !safeKeySegmentPattern.test(segment),
    )
  ) {
    throw new UnsafeStorageKeyError();
  }

  const resolvedRoot = resolve(root);
  const objectPath = resolve(resolvedRoot, ...segments);
  const relativePath = relative(resolvedRoot, objectPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new UnsafeStorageKeyError();
  }
  return objectPath;
}

export interface LocalFilesystemStorageOptions {
  readonly publicTransferPath?: string | undefined;
  readonly root: string;
}

export class LocalFilesystemStorageProvider implements StorageTransferProvider {
  readonly encryptionMode = "filesystem-permissions";
  readonly providerId = "local-filesystem";
  readonly #publicTransferPath: string;
  readonly #root: string;

  constructor(options: LocalFilesystemStorageOptions) {
    this.#root = resolve(options.root);
    this.#publicTransferPath = (
      options.publicTransferPath ?? "/api/document-transfers"
    ).replace(/\/$/, "");
  }

  async createUploadAuthorization(
    input: UploadAuthorizationInput,
  ): Promise<StorageTransferAuthorization> {
    resolveStoragePath(this.#root, input.storageKey);
    return {
      expiresAt: input.expiresAt,
      headers: { "content-type": "application/octet-stream" },
      method: "PUT",
      url: `${this.#publicTransferPath}/upload/${encodeURIComponent(input.credential)}`,
    };
  }

  async createDownloadAuthorization(
    input: DownloadAuthorizationInput,
  ): Promise<StorageTransferAuthorization> {
    resolveStoragePath(this.#root, input.storageKey);
    return {
      expiresAt: input.expiresAt,
      headers: {},
      method: "GET",
      url: `${this.#publicTransferPath}/download/${encodeURIComponent(input.credential)}`,
    };
  }

  async writeObject(
    storageKey: string,
    bytes: Uint8Array,
    expected: StoredObjectMetadata,
  ): Promise<void> {
    const objectPath = resolveStoragePath(this.#root, storageKey);
    const directory = dirname(objectPath);
    await mkdir(directory, { mode: 0o700, recursive: true });
    const stagingDirectory = await mkdtemp(join(directory, ".upload-"));
    try {
      const stagedPath = join(stagingDirectory, "content");
      await writeFile(stagedPath, bytes, {
        flag: "wx",
        flush: true,
        mode: 0o600,
      });
      try {
        // Publish complete bytes without replacing a competing writer's object.
        await link(stagedPath, objectPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const existing = await this.inspectObject(storageKey);
        if (
          existing.sizeBytes !== expected.sizeBytes ||
          existing.checksumSha256 !== expected.checksumSha256
        ) {
          throw new StorageObjectConflictError();
        }
      }
    } finally {
      await rm(stagingDirectory, { force: true, recursive: true });
    }
  }

  async readObject(storageKey: string): Promise<Uint8Array> {
    const objectPath = resolveStoragePath(this.#root, storageKey);
    try {
      return await readFile(objectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageObjectUnavailableError();
      }
      throw error;
    }
  }

  async inspectObject(storageKey: string): Promise<StoredObjectMetadata> {
    const bytes = await this.readObject(storageKey);
    return { checksumSha256: checksum(bytes), sizeBytes: bytes.byteLength };
  }

  async *listObjects(
    prefix: string,
    signal: AbortSignal,
  ): AsyncIterable<StorageInventoryEntry> {
    const directoryPath = resolveStoragePath(this.#root, prefix);
    try {
      const paths = [this.#root];
      let parentPath = this.#root;
      for (const segment of prefix.split("/")) {
        parentPath = resolve(parentPath, segment);
        paths.push(parentPath);
      }
      const ancestors = [];
      for (const path of paths) {
        signal.throwIfAborted();
        const metadata = await lstat(path).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT" && path !== this.#root) return null;
            throw error;
          },
        );
        if (metadata === null) return;
        if (!metadata.isDirectory())
          throw new StorageInventoryUnavailableError();
        ancestors.push({ path, dev: metadata.dev, ino: metadata.ino });
      }

      const directory = await opendir(directoryPath);
      for await (const entry of directory) {
        signal.throwIfAborted();
        const metadata = await lstat(resolve(directoryPath, entry.name));
        yield {
          storageKey: `${prefix}/${entry.name}`,
          kind:
            metadata.isFile() && metadata.nlink === 1 ? "file" : "unsupported",
        };
      }
      // Detect replacement during enumeration; the storage root must be trusted.
      for (const ancestor of ancestors) {
        signal.throwIfAborted();
        const metadata = await lstat(ancestor.path);
        if (
          !metadata.isDirectory() ||
          metadata.dev !== ancestor.dev ||
          metadata.ino !== ancestor.ino
        ) {
          throw new StorageInventoryUnavailableError();
        }
      }
    } catch {
      throw new StorageInventoryUnavailableError();
    }
  }
}

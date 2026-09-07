import { createHash } from "node:crypto";
import COS from "cos-nodejs-sdk-v5";
import {
  StorageInventoryUnavailableError,
  StorageObjectUnavailableError,
} from "./errors.js";
import { assertSafeStorageKey } from "./storage-key.js";
import type {
  DownloadAuthorizationInput,
  StorageProvider,
  StorageInventoryEntry,
  StoredObjectMetadata,
  StorageTransferAuthorization,
  UploadAuthorizationInput,
} from "./types.js";

const inventoryPageSize = 1000;

function decodeListValue(value: unknown): string {
  if (typeof value !== "string") throw new StorageInventoryUnavailableError();
  return decodeURIComponent(value);
}

function compareKeys(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseInventoryPage(
  page: COS.GetBucketResult,
  bucket: string,
  prefix: string,
  marker: string,
) {
  if (
    page.statusCode !== 200 ||
    page.Name !== bucket ||
    page.EncodingType !== "url" ||
    decodeListValue(page.Prefix) !== prefix ||
    decodeListValue(page.Marker) !== marker ||
    !("Delimiter" in page) ||
    decodeListValue(page.Delimiter) !== "/" ||
    Number(page.MaxKeys) !== inventoryPageSize ||
    !["true", "false"].includes(page.IsTruncated) ||
    !Array.isArray(page.Contents) ||
    !Array.isArray(page.CommonPrefixes) ||
    page.Contents.length + page.CommonPrefixes.length > inventoryPageSize
  )
    throw new StorageInventoryUnavailableError();

  const entries: StorageInventoryEntry[] = [
    ...page.Contents.map((object) => ({
      storageKey: decodeListValue(object.Key),
      kind: "file" as const,
    })),
    ...page.CommonPrefixes.map((directory) => ({
      storageKey: decodeListValue(directory.Prefix),
      kind: "unsupported" as const,
    })),
  ];
  const seen = new Set<string>();
  let lastKey = marker;
  for (const entry of entries) {
    const name = entry.storageKey.slice(prefix.length);
    const immediate =
      entry.kind === "file"
        ? !name.includes("/")
        : name.length > 1 &&
          name.endsWith("/") &&
          !name.slice(0, -1).includes("/");
    if (
      !entry.storageKey.startsWith(prefix) ||
      !immediate ||
      compareKeys(entry.storageKey, marker) <= 0 ||
      seen.has(entry.storageKey)
    )
      throw new StorageInventoryUnavailableError();
    seen.add(entry.storageKey);
    if (compareKeys(entry.storageKey, lastKey) > 0) lastKey = entry.storageKey;
  }
  const nextMarker =
    page.IsTruncated === "true" ? decodeListValue(page.NextMarker) : undefined;
  if (
    nextMarker !== undefined &&
    (entries.length === 0 || nextMarker !== lastKey)
  )
    throw new StorageInventoryUnavailableError();
  return { entries, nextMarker };
}

export interface TencentCosStorageOptions {
  readonly bucket: string;
  readonly region: string;
  readonly secretId: string;
  readonly secretKey: string;
  readonly securityToken?: string | undefined;
  readonly credentialsExpireAt?: Date | undefined;
  readonly kmsKeyId?: string | undefined;
  readonly maximumObjectSizeBytes: number;
}

export class TencentCosStorageProvider implements StorageProvider {
  readonly providerId = "tencent-cos";
  readonly encryptionMode: string;
  readonly #options: TencentCosStorageOptions;
  readonly #client: COS;
  readonly #fetch: typeof fetch;

  constructor(
    options: TencentCosStorageOptions,
    dependencies: {
      readonly client?: COS | undefined;
      readonly fetch?: typeof fetch | undefined;
    } = {},
  ) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,49}-\d{5,20}$/.test(options.bucket) ||
      !/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.region) ||
      !options.secretId ||
      !options.secretKey ||
      !Number.isSafeInteger(options.maximumObjectSizeBytes) ||
      options.maximumObjectSizeBytes < 0 ||
      (options.securityToken !== undefined &&
        options.credentialsExpireAt === undefined) ||
      (options.credentialsExpireAt !== undefined &&
        !Number.isFinite(options.credentialsExpireAt.getTime())) ||
      (options.kmsKeyId !== undefined &&
        !/^[A-Za-z0-9-]{1,128}$/.test(options.kmsKeyId))
    )
      throw new Error("Invalid Tencent COS storage configuration.");
    this.#options = {
      ...options,
      credentialsExpireAt:
        options.credentialsExpireAt === undefined
          ? undefined
          : new Date(options.credentialsExpireAt),
    };
    this.encryptionMode =
      options.kmsKeyId === undefined ? "cos-sse-aes256" : "cos-sse-kms";
    this.#fetch = dependencies.fetch ?? fetch;
    this.#client =
      dependencies.client ??
      new COS({
        SecretId: options.secretId,
        SecretKey: options.secretKey,
        ...(options.securityToken === undefined
          ? {}
          : { SecurityToken: options.securityToken }),
        Protocol: "https:",
        Timeout: 10_000,
        FollowRedirect: false,
      });
  }

  async createUploadAuthorization(
    input: UploadAuthorizationInput,
  ): Promise<StorageTransferAuthorization> {
    assertSafeStorageKey(input.storageKey);
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 0 ||
      input.sizeBytes > this.#options.maximumObjectSizeBytes ||
      !/^[a-f0-9]{64}$/.test(input.checksumSha256)
    ) {
      throw new Error("Invalid COS upload metadata.");
    }
    const headers: Record<string, string> = {
      "content-type": "application/octet-stream",
      "content-encoding": "identity",
      "content-length": String(input.sizeBytes),
      "x-cos-acl": "private",
      "x-cos-forbid-overwrite": "true",
      "x-cos-meta-sha256": input.checksumSha256,
      "x-cos-server-side-encryption":
        this.#options.kmsKeyId === undefined ? "AES256" : "cos/kms",
    };
    if (this.#options.kmsKeyId !== undefined)
      headers["x-cos-server-side-encryption-cos-kms-key-id"] =
        this.#options.kmsKeyId;
    return this.#sign("PUT", input.storageKey, input.expiresAt, headers);
  }

  createDownloadAuthorization(
    input: DownloadAuthorizationInput,
  ): Promise<StorageTransferAuthorization> {
    const filename = encodeURIComponent(input.originalFilename).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return this.#sign(
      "GET",
      input.storageKey,
      input.expiresAt,
      {},
      {
        "response-content-type": "application/octet-stream",
        "response-content-encoding": "identity",
        "response-cache-control": "private, no-store",
        "response-content-disposition": `attachment; filename="download"; filename*=UTF-8''${filename}`,
      },
    );
  }

  async inspectObject(storageKey: string): Promise<StoredObjectMetadata> {
    const authorization = await this.#sign(
      "GET",
      storageKey,
      new Date(Date.now() + 60_000),
      {},
      {
        "response-content-encoding": "identity",
      },
    );
    const response = await this.#fetch(authorization.url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    });
    const declaredLength = response.headers.get("content-length");
    const expectedEncryption =
      this.#options.kmsKeyId === undefined ? "AES256" : "cos/kms";
    if (
      response.status !== 200 ||
      response.body === null ||
      response.headers.get("x-cos-server-side-encryption") !==
        expectedEncryption ||
      ![null, "identity"].includes(response.headers.get("content-encoding")) ||
      (declaredLength !== null &&
        (!/^\d+$/.test(declaredLength) ||
          Number(declaredLength) > this.#options.maximumObjectSizeBytes))
    ) {
      await response.body?.cancel();
      throw new StorageObjectUnavailableError();
    }
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let sizeBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        sizeBytes += chunk.value.byteLength;
        if (sizeBytes > this.#options.maximumObjectSizeBytes)
          throw new StorageObjectUnavailableError();
        hash.update(chunk.value);
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
    return { sizeBytes, checksumSha256: hash.digest("hex") };
  }

  async *listObjects(
    prefix: string,
    signal: AbortSignal,
  ): AsyncIterable<StorageInventoryEntry> {
    assertSafeStorageKey(prefix);
    const objectPrefix = `${prefix}/`;
    let marker = "";
    try {
      signal.throwIfAborted();
      await this.#assertBucketPolicy();
      while (true) {
        signal.throwIfAborted();
        const page = await this.#client.getBucket({
          ...this.#bucket(),
          Prefix: objectPrefix,
          Marker: marker,
          Delimiter: "/",
          EncodingType: "url",
          MaxKeys: inventoryPageSize,
        });
        signal.throwIfAborted();
        const { entries, nextMarker } = parseInventoryPage(
          page,
          this.#options.bucket,
          objectPrefix,
          marker,
        );
        for (const entry of entries) {
          signal.throwIfAborted();
          yield entry;
        }
        if (nextMarker === undefined) return;
        marker = nextMarker;
      }
    } catch {
      throw new StorageInventoryUnavailableError();
    }
  }

  #bucket() {
    return { Bucket: this.#options.bucket, Region: this.#options.region };
  }

  async #assertBucketPolicy(): Promise<void> {
    const [versioning, acl] = await Promise.all([
      this.#client.getBucketVersioning(this.#bucket()),
      this.#client.getBucketAcl(this.#bucket()),
    ]);
    const configuration: unknown = versioning.VersioningConfiguration;
    // COS does not enforce its overwrite guard on version-enabled buckets.
    if (
      configuration === null ||
      typeof configuration !== "object" ||
      Array.isArray(configuration) ||
      Object.keys(configuration).length !== 0
    ) {
      throw new Error("COS requires a never-versioned bucket.");
    }
    if (
      acl.ACL !== "private" ||
      !acl.Owner?.ID ||
      !Array.isArray(acl.Grants) ||
      acl.Grants.some(
        (grant) =>
          !("ID" in grant.Grantee) ||
          grant.Grantee.ID !== acl.Owner.ID ||
          grant.Permission !== "FULL_CONTROL",
      )
    ) {
      throw new Error("COS requires a private owner-only bucket ACL.");
    }
  }

  async #sign(
    method: "GET" | "PUT",
    storageKey: string,
    deadline: Date,
    headers: Record<string, string>,
    query: Record<string, string> = {},
  ): Promise<StorageTransferAuthorization> {
    assertSafeStorageKey(storageKey);
    const expiresAt = Math.min(
      deadline.getTime(),
      this.#options.credentialsExpireAt?.getTime() ?? Infinity,
    );
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining < 1_000 || remaining > 900_000)
      throw new Error("COS transfer expiry must be within fifteen minutes.");
    await this.#assertBucketPolicy();
    const seconds = Math.floor((expiresAt - Date.now()) / 1_000);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 900)
      throw new Error("COS transfer expiry must be within fifteen minutes.");
    const url = await new Promise<string>((resolve, reject) => {
      this.#client.getObjectUrl(
        {
          ...this.#bucket(),
          Key: storageKey,
          Method: method,
          Sign: true,
          Protocol: "https:",
          Expires: seconds,
          Headers: { ...headers },
          Query: query,
        },
        (error, result) => (error ? reject(error) : resolve(result.Url)),
      );
    });
    const parsed = new URL(url);
    const signedExpiry =
      Number(parsed.searchParams.get("q-sign-time")?.split(";")[1]) * 1_000;
    if (
      parsed.protocol !== "https:" ||
      parsed.host !==
        `${this.#options.bucket}.cos.${this.#options.region}.myqcloud.com` ||
      decodeURIComponent(parsed.pathname) !== `/${storageKey}` ||
      !parsed.searchParams.has("q-signature") ||
      !Number.isFinite(signedExpiry) ||
      signedExpiry > expiresAt ||
      signedExpiry <= Date.now()
    ) {
      throw new Error("COS returned an invalid transfer authorization.");
    }
    return { method, url, headers, expiresAt: new Date(signedExpiry) };
  }
}

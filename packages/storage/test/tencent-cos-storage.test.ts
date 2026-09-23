import { createHash } from "node:crypto";
import COS from "cos-nodejs-sdk-v5";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StorageObjectConflictError,
  StorageObjectUnavailableError,
  TencentCosStorageProvider,
} from "../src/index.js";
import { cosOptions, createCosFixture } from "./cos-fixture.js";

const bytes = new Uint8Array([0, 255, 10, 32]);
const input = () => ({
  storageKey: "workspaces/workspace/documents/document",
  credential: "opaque-application-credential",
  expiresAt: new Date(Date.now() + 60_000),
  mimeType: "text/html",
  originalFilename: "document.txt",
  sizeBytes: bytes.length,
  checksumSha256: createHash("sha256").update(bytes).digest("hex"),
});
afterEach(() => vi.restoreAllMocks());

describe("Tencent COS direct transfers", () => {
  it("writes native uploads through a signed, private, create-only COS request", async () => {
    const { provider, transport } = createCosFixture();
    const payload = new Uint8Array([1, ...bytes, 2]).subarray(1, -1);
    transport.mockResolvedValue(new Response(null, { status: 200 }));
    await provider.writeObject(input().storageKey, payload, {
      sizeBytes: bytes.length,
      checksumSha256: input().checksumSha256,
    });
    expect(transport).toHaveBeenCalledOnce();
    const [url, request] = transport.mock.calls[0] ?? [];
    expect(String(url)).toContain("q-signature=");
    expect(request).toMatchObject({
      method: "PUT",
      redirect: "error",
      credentials: "omit",
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "identity",
        "content-length": String(bytes.length),
        "x-cos-acl": "private",
        "x-cos-forbid-overwrite": "true",
        "x-cos-meta-sha256": input().checksumSha256,
        "x-cos-server-side-encryption": "AES256",
      },
    });
    expect(Buffer.from(request?.body as Uint8Array)).toEqual(
      Buffer.from(bytes),
    );
    const body = request?.body as Buffer | undefined;
    expect(body?.buffer).toBe(payload.buffer);
    expect(body?.byteOffset).toBe(payload.byteOffset);
  });

  it("forwards native uploads with the configured KMS headers", async () => {
    const { provider, transport } = createCosFixture({
      kmsKeyId: "test-kms-key",
    });
    transport.mockResolvedValue(new Response(null, { status: 200 }));
    await provider.writeObject(input().storageKey, bytes, {
      sizeBytes: bytes.length,
      checksumSha256: input().checksumSha256,
    });
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-cos-server-side-encryption": "cos/kms",
      "x-cos-server-side-encryption-cos-kms-key-id": "test-kms-key",
    });
  });

  it.each([409, 412])(
    "accepts identical content after COS rejects a create-only upload with %i",
    async (status) => {
      const { provider, transport } = createCosFixture();
      transport.mockImplementation(async (_url, request) =>
        request?.method === "PUT"
          ? new Response(null, { status })
          : new Response(bytes, {
              headers: { "x-cos-server-side-encryption": "AES256" },
            }),
      );
      await expect(
        provider.writeObject(input().storageKey, bytes, {
          sizeBytes: bytes.length,
          checksumSha256: input().checksumSha256,
        }),
      ).resolves.toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );

  it.each([409, 412])(
    "rejects different content after COS rejects a create-only upload with %i",
    async (status) => {
      const { provider, transport } = createCosFixture();
      transport.mockImplementation(async (_url, request) =>
        request?.method === "PUT"
          ? new Response(null, { status })
          : new Response(new Uint8Array([1, 2, 3]), {
              headers: { "x-cos-server-side-encryption": "AES256" },
            }),
      );
      await expect(
        provider.writeObject(input().storageKey, bytes, {
          sizeBytes: bytes.length,
          checksumSha256: input().checksumSha256,
        }),
      ).rejects.toBeInstanceOf(StorageObjectConflictError);
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );

  it("does not accept a same-byte conflict without the required encryption", async () => {
    const { provider, transport } = createCosFixture();
    transport.mockImplementation(async (_url, request) =>
      request?.method === "PUT"
        ? new Response(null, { status: 409 })
        : new Response(bytes),
    );
    await expect(
      provider.writeObject(input().storageKey, bytes, {
        sizeBytes: bytes.length,
        checksumSha256: input().checksumSha256,
      }),
    ).rejects.toBeInstanceOf(StorageObjectUnavailableError);
  });

  it.each([403, 500])("rejects COS upload failure %i", async (status) => {
    const { provider, transport } = createCosFixture();
    transport.mockResolvedValue(new Response(null, { status }));
    await expect(
      provider.writeObject(input().storageKey, bytes, {
        sizeBytes: bytes.length,
        checksumSha256: input().checksumSha256,
      }),
    ).rejects.toBeInstanceOf(StorageObjectUnavailableError);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects unsafe bucket policy before forwarding bytes", async () => {
    const { provider, versioning, transport } = createCosFixture();
    versioning.mockResolvedValue({
      VersioningConfiguration: { Status: "Enabled" },
    } as COS.GetBucketVersioningResult);
    await expect(
      provider.writeObject(input().storageKey, bytes, {
        sizeBytes: bytes.length,
        checksumSha256: input().checksumSha256,
      }),
    ).rejects.toThrow("never-versioned");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array([1]), new Uint8Array([1, 2, 3, 4])])(
    "rejects altered native-upload bytes before sending them to COS",
    async (altered) => {
      const { provider, transport } = createCosFixture();
      await expect(
        provider.writeObject(input().storageKey, altered, {
          sizeBytes: bytes.length,
          checksumSha256: input().checksumSha256,
        }),
      ).rejects.toBeInstanceOf(StorageObjectUnavailableError);
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it("signs the exact create-only encrypted upload policy", async () => {
    const { provider, versioning, acl } = createCosFixture();
    const requested = input();
    const authorization = await provider.createUploadAuthorization(requested);
    expect(versioning).toHaveBeenCalledOnce();
    expect(acl).toHaveBeenCalledOnce();
    const url = new URL(authorization.url);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe(
      `${cosOptions.bucket}.cos.${cosOptions.region}.myqcloud.com`,
    );
    expect(url.pathname).toBe(`/${requested.storageKey}`);
    expect(authorization.url).not.toContain(cosOptions.secretKey);
    expect(authorization.url).not.toContain(requested.credential);
    expect(authorization.headers).toEqual({
      "content-type": "application/octet-stream",
      "content-encoding": "identity",
      "content-length": String(bytes.length),
      "x-cos-acl": "private",
      "x-cos-forbid-overwrite": "true",
      "x-cos-meta-sha256": requested.checksumSha256,
      "x-cos-server-side-encryption": "AES256",
    });
    const signingInput: COS.StaticGetAuthorizationOptions = {
      SecretId: cosOptions.secretId,
      SecretKey: cosOptions.secretKey,
      Bucket: cosOptions.bucket,
      Region: cosOptions.region,
      Method: "PUT",
      Key: requested.storageKey,
      KeyTime: url.searchParams.get("q-sign-time") ?? "",
      Headers: { ...authorization.headers },
    };
    const signature = (overrides: Partial<COS.StaticGetAuthorizationOptions>) =>
      new URLSearchParams(
        COS.getAuthorization({ ...signingInput, ...overrides }),
      ).get("q-signature");
    expect(signature({})).toBe(url.searchParams.get("q-signature"));
    const mutations: Partial<COS.StaticGetAuthorizationOptions>[] = [
      { Method: "GET" },
      { Key: "another-key" },
      { Bucket: "other-1250000000" },
      { KeyTime: "1;9999999999" },
      ...[
        "x-cos-forbid-overwrite",
        "x-cos-acl",
        "content-length",
        "x-cos-server-side-encryption",
        "x-cos-meta-sha256",
        "content-encoding",
      ].map((header) => ({
        Headers: { ...authorization.headers, [header]: "changed" },
      })),
    ];
    for (const overrides of mutations)
      expect(signature(overrides)).not.toBe(
        url.searchParams.get("q-signature"),
      );
  });

  it("signs download disposition, binary type, and private caching", async () => {
    const { provider } = createCosFixture();
    const authorization = await provider.createDownloadAuthorization({
      ...input(),
      originalFilename: "line\r\n\"\u7968'(*).txt",
    });
    const url = new URL(authorization.url);
    expect(url.searchParams.get("response-content-type")).toBe(
      "application/octet-stream",
    );
    expect(url.searchParams.get("response-cache-control")).toBe(
      "private, no-store",
    );
    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment; filename=\"download\"; filename*=UTF-8''line%0D%0A%22%E7%A5%A8%27%28%2A%29.txt",
    );
    expect(url.searchParams.get("q-url-param-list")?.split(";")).toEqual([
      "response-cache-control",
      "response-content-disposition",
      "response-content-encoding",
      "response-content-type",
    ]);
    expect(authorization.headers).toEqual({});
  });

  it("caps signatures at temporary credential expiry and signs KMS selection", async () => {
    const deadline = new Date(Date.now() + 30_000);
    const { provider } = createCosFixture({
      securityToken: "temporary-test-token",
      credentialsExpireAt: deadline,
      kmsKeyId: "test-kms-key",
    });
    deadline.setFullYear(deadline.getFullYear() + 1);
    const authorization = await provider.createUploadAuthorization(input());
    expect(authorization.expiresAt.getTime()).toBeLessThan(Date.now() + 31_000);
    expect(
      new URL(authorization.url).searchParams.get("x-cos-security-token"),
    ).toBe("temporary-test-token");
    expect(authorization.headers["x-cos-server-side-encryption"]).toBe(
      "cos/kms",
    );
    expect(
      authorization.headers["x-cos-server-side-encryption-cos-kms-key-id"],
    ).toBe("test-kms-key");
    expect(provider.encryptionMode).toBe("cos-sse-kms");
  });

  it.each([-1000, 0, 901_000, Number.NaN])(
    "rejects invalid expiry offset %s",
    async (offset) => {
      const { provider } = createCosFixture();
      await expect(
        provider.createDownloadAuthorization({
          ...input(),
          expiresAt: new Date(Date.now() + offset),
        }),
      ).rejects.toThrow("expiry");
    },
  );

  it.each(["Enabled", "Suspended", "", null, [], "malformed"])(
    "rejects unsafe versioning state %j",
    async (status) => {
      const { provider, versioning } = createCosFixture();
      versioning.mockResolvedValue({
        VersioningConfiguration: { Status: status },
      } as COS.GetBucketVersioningResult);
      await expect(provider.createUploadAuthorization(input())).rejects.toThrow(
        "never-versioned",
      );
      await expect(
        provider.createDownloadAuthorization(input()),
      ).rejects.toThrow("never-versioned");
      await expect(provider.inspectObject(input().storageKey)).rejects.toThrow(
        "never-versioned",
      );
    },
  );

  it("rejects public and additional-principal bucket ACLs", async () => {
    const { provider, acl } = createCosFixture();
    for (const result of [
      { ACL: "public-read" },
      {
        ACL: "private",
        Owner: { ID: "owner" },
        Grants: [{ Grantee: { ID: "stranger" }, Permission: "READ" }],
      },
      {
        ACL: "private",
        Owner: { ID: "owner" },
        Grants: [{ Grantee: { URI: "AllUsers" }, Permission: "READ" }],
      },
    ]) {
      acl.mockResolvedValue(result as COS.GetBucketAclResult);
      await expect(provider.createUploadAuthorization(input())).rejects.toThrow(
        "private owner-only",
      );
    }
  });

  it("fails closed when bucket configuration is unavailable", async () => {
    const { provider, versioning, transport } = createCosFixture();
    versioning.mockRejectedValue(new Error("AccessDenied"));
    await expect(provider.inspectObject(input().storageKey)).rejects.toThrow(
      "AccessDenied",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("hashes actual bytes rather than supplied object metadata", async () => {
    const { provider, transport } = createCosFixture();
    transport.mockResolvedValue(
      new Response(bytes, {
        headers: {
          "x-cos-meta-sha256": "forged",
          "x-cos-server-side-encryption": "AES256",
        },
      }),
    );
    await expect(provider.inspectObject(input().storageKey)).resolves.toEqual({
      sizeBytes: bytes.length,
      checksumSha256: input().checksumSha256,
    });
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining("https://"),
      expect.objectContaining({
        redirect: "error",
        credentials: "omit",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("cancels oversized streams even without a declared size", async () => {
    const { provider, transport } = createCosFixture({
      maximumObjectSizeBytes: 4,
    });
    const cancelled = vi.fn();
    transport.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(5));
          },
          cancel: cancelled,
        }),
        { headers: { "x-cos-server-side-encryption": "AES256" } },
      ),
    );
    await expect(
      provider.inspectObject(input().storageKey),
    ).rejects.toBeInstanceOf(StorageObjectUnavailableError);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each([403, 404, 500, 206, 302])(
    "rejects unsuccessful or partial response %i",
    async (status) => {
      const { provider, transport } = createCosFixture();
      transport.mockResolvedValue(new Response(bytes, { status }));
      await expect(
        provider.inspectObject(input().storageKey),
      ).rejects.toBeInstanceOf(StorageObjectUnavailableError);
    },
  );

  it.each([
    {},
    { "x-cos-server-side-encryption": "cos/kms" },
    { "x-cos-server-side-encryption": "AES256", "content-length": "99999" },
    { "x-cos-server-side-encryption": "AES256", "content-length": "invalid" },
    { "x-cos-server-side-encryption": "AES256", "content-encoding": "gzip" },
  ])("rejects invalid storage response headers %j", async (headers) => {
    const { provider, transport } = createCosFixture();
    transport.mockResolvedValue(new Response(bytes, { headers }));
    await expect(
      provider.inspectObject(input().storageKey),
    ).rejects.toBeInstanceOf(StorageObjectUnavailableError);
  });

  it.each([
    { bucket: "bucket.evil.test" },
    { region: "ap-example/../host" },
    { secretKey: "" },
    { maximumObjectSizeBytes: -1 },
    { securityToken: "temporary-without-expiry" },
    { credentialsExpireAt: new Date("invalid") },
    { kmsKeyId: "bad\r\nkey" },
  ])("rejects invalid configuration %j", (options) => {
    expect(
      () => new TencentCosStorageProvider({ ...cosOptions, ...options }),
    ).toThrow("configuration");
  });
});

import type COS from "cos-nodejs-sdk-v5";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StorageInventoryUnavailableError,
  type StorageProvider,
  UnsafeStorageKeyError,
} from "../src/index.js";
import { cosOptions, createCosFixture } from "./cos-fixture.js";

const prefix = "workspaces/workspace/documents/";
const firstKey = `${prefix}first`;
const lastKey = `${prefix}last`;

function page(overrides: Record<string, unknown> = {}): COS.GetBucketResult {
  return {
    statusCode: 200,
    headers: {},
    Name: cosOptions.bucket,
    Prefix: encodeURIComponent(prefix),
    Marker: "",
    Delimiter: "%2F",
    EncodingType: "url",
    MaxKeys: "1000",
    IsTruncated: "false",
    Contents: [
      {
        Key: encodeURIComponent(firstKey),
        LastModified: "2026-10-01T00:00:00Z",
        ETag: '"fixture"',
        Size: "1",
        StorageClass: "STANDARD",
        Owner: { ID: "owner" },
      },
    ],
    CommonPrefixes: [],
    ...overrides,
  } as COS.GetBucketResult;
}

async function collect(
  provider: StorageProvider,
  signal = new AbortController().signal,
  requestedPrefix = prefix.slice(0, -1),
) {
  if (provider.listObjects === undefined)
    throw new Error("Inventory unavailable");
  const entries = [];
  for await (const entry of provider.listObjects(requestedPrefix, signal))
    entries.push(entry);
  return entries;
}

afterEach(() => vi.restoreAllMocks());

describe("COS inventory with simulated listing responses", () => {
  it("paginates immediate objects and reports nested prefixes without fetching content", async () => {
    const { client, provider, transport } = createCosFixture();
    const directory = `${prefix}folder/`;
    const list = vi
      .spyOn(client, "getBucket")
      .mockResolvedValueOnce(
        page({
          CommonPrefixes: [{ Prefix: encodeURIComponent(directory) }],
          IsTruncated: "true",
          NextMarker: encodeURIComponent(directory),
        }),
      )
      .mockResolvedValueOnce(
        page({
          Marker: encodeURIComponent(directory),
          Contents: [{ Key: encodeURIComponent(lastKey) }],
        }),
      );
    await expect(collect(provider)).resolves.toEqual([
      { storageKey: firstKey, kind: "file" },
      { storageKey: directory, kind: "unsupported" },
      { storageKey: lastKey, kind: "file" },
    ]);
    expect(list.mock.calls.map(([parameters]) => parameters)).toEqual([
      {
        Bucket: cosOptions.bucket,
        Region: cosOptions.region,
        Prefix: prefix,
        Marker: "",
        Delimiter: "/",
        EncodingType: "url",
        MaxKeys: 1000,
      },
      {
        Bucket: cosOptions.bucket,
        Region: cosOptions.region,
        Prefix: prefix,
        Marker: directory,
        Delimiter: "/",
        EncodingType: "url",
        MaxKeys: 1000,
      },
    ]);
    expect(transport).not.toHaveBeenCalled();
  });

  it("decodes keys once and accepts an empty final page", async () => {
    const { client, provider } = createCosFixture();
    const key = `${prefix}\u{1f30d}%2F`;
    const list = vi.spyOn(client, "getBucket").mockResolvedValueOnce(
      page({
        Contents: [{ Key: encodeURIComponent(key) }],
      }),
    );
    await expect(collect(provider)).resolves.toEqual([
      { storageKey: key, kind: "file" },
    ]);
    list.mockResolvedValueOnce(page({ Contents: [] }));
    await expect(collect(provider)).resolves.toEqual([]);
  });

  it("compares continuation keys in UTF-8 order", async () => {
    const { client, provider } = createCosFixture();
    const keys = [`${prefix}\ue000`, `${prefix}\u{10000}`] as const;
    const marker = keys[1];
    vi.spyOn(client, "getBucket")
      .mockResolvedValueOnce(
        page({
          Contents: keys.map((key) => ({ Key: encodeURIComponent(key) })),
          IsTruncated: "true",
          NextMarker: encodeURIComponent(marker),
        }),
      )
      .mockResolvedValueOnce(
        page({ Marker: encodeURIComponent(marker), Contents: [] }),
      );
    expect((await collect(provider)).map((entry) => entry.storageKey)).toEqual(
      keys,
    );
  });

  it("accepts a complete page at the requested entry bound", async () => {
    const { client, provider } = createCosFixture();
    const keys = Array.from(
      { length: 1000 },
      (_, index) => `${prefix}${String(index).padStart(4, "0")}`,
    );
    const list = vi.spyOn(client, "getBucket").mockResolvedValue(
      page({
        Contents: keys.map((key) => ({ Key: encodeURIComponent(key) })),
      }),
    );
    expect((await collect(provider)).map((entry) => entry.storageKey)).toEqual(
      keys,
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it.each(
    Object.entries({
      bucket: { Name: "other-bucket" },
      status: { statusCode: 206 },
      prefix: { Prefix: "other/" },
      marker: { Marker: "unexpected" },
      delimiter: { Delimiter: "" },
      encoding: { EncodingType: undefined },
      truncation: { IsTruncated: undefined },
      "boolean truncation": { IsTruncated: true },
      "page bound": { MaxKeys: "1001" },
      contents: { Contents: null },
      directories: { CommonPrefixes: null },
      "encoded key": { Contents: [{ Key: "malformed%" }] },
      "out-of-prefix key": { Contents: [{ Key: "other/secret" }] },
      "nested key": { Contents: [{ Key: `${prefix}nested/file` }] },
      "nested prefix": {
        CommonPrefixes: [{ Prefix: `${prefix}nested/deep/` }],
      },
      "missing next marker": { IsTruncated: "true" },
      "empty truncated page": {
        IsTruncated: "true",
        Contents: [],
        NextMarker: firstKey,
      },
      "backward marker": { IsTruncated: "true", NextMarker: `${prefix}before` },
      "skipped marker": { IsTruncated: "true", NextMarker: lastKey },
      "out-of-prefix marker": { IsTruncated: "true", NextMarker: "other/" },
      "oversized page": {
        Contents: Array.from({ length: 1001 }, () => ({ Key: firstKey })),
      },
      "duplicate keys": { Contents: [{ Key: firstKey }, { Key: firstKey }] },
    }),
  )("rejects invalid listing %s", async (_name, overrides) => {
    const { client, provider } = createCosFixture();
    const list = vi
      .spyOn(client, "getBucket")
      .mockResolvedValue(page(overrides));
    await expect(collect(provider)).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated page entries and markers", async () => {
    const { client, provider } = createCosFixture();
    const list = vi
      .spyOn(client, "getBucket")
      .mockResolvedValueOnce(
        page({ IsTruncated: "true", NextMarker: firstKey }),
      )
      .mockResolvedValueOnce(
        page({ Marker: firstKey, IsTruncated: "true", NextMarker: firstKey }),
      );
    await expect(collect(provider)).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("stops on cancellation before calls and after an in-flight response", async () => {
    const { client, provider } = createCosFixture();
    const controller = new AbortController();
    const list = vi
      .spyOn(client, "getBucket")
      .mockImplementationOnce(async () => {
        controller.abort();
        return page({ IsTruncated: "true", NextMarker: firstKey });
      });
    await expect(collect(provider, AbortSignal.abort())).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
    expect(list).not.toHaveBeenCalled();
    await expect(collect(provider, controller.signal)).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("stops pagination when the consumer closes the iterator", async () => {
    const { client, provider } = createCosFixture();
    const list = vi.spyOn(client, "getBucket").mockResolvedValue(
      page({
        IsTruncated: "true",
        NextMarker: firstKey,
      }),
    );
    const storage: StorageProvider = provider;
    if (!storage.listObjects) throw new Error("Inventory unavailable");
    for await (const entry of storage.listObjects(
      prefix.slice(0, -1),
      new AbortController().signal,
    )) {
      expect(entry.storageKey).toBe(firstKey);
      break;
    }
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe prefixes, unavailable policy checks, and cloud errors", async () => {
    const { client, provider, acl } = createCosFixture();
    const list = vi
      .spyOn(client, "getBucket")
      .mockRejectedValue(new Error("private cloud detail"));
    await expect(
      collect(provider, undefined, "../other"),
    ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
    expect(list).not.toHaveBeenCalled();
    acl.mockRejectedValueOnce(new Error("Bucket policy unavailable"));
    await expect(collect(provider)).rejects.toBeInstanceOf(
      StorageInventoryUnavailableError,
    );
    expect(list).not.toHaveBeenCalled();
    await expect(collect(provider)).rejects.toMatchObject({
      message: "The storage inventory could not be completed.",
    });
  });
});

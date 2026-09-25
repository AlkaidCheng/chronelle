import type { LivTalesApiClient } from "@livtales/api-client";
import { maximumNativeDocumentSizeBytes } from "@livtales/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  NativeFiles,
  type NativeFilePlatform,
  type NativeTask,
} from "../src/files/native-files";

const credential = {
  accessToken: "session-token",
  workspaceId: "workspace-id",
};
const file = { name: "brief.pdf", path: "wxfile://selected", size: 3 };

function resolvedTask<Result>(result: Result): NativeTask<Result> {
  return Object.assign(Promise.resolve(result), { abort: vi.fn() });
}

function harness() {
  const authorizeDocumentUpload = vi.fn().mockResolvedValue({
    id: "authorization-id",
    upload: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      headers: {},
      method: "POST",
      url: "/api/document-transfers/upload-file/one-use-token",
    },
  });
  const finalizeDocumentUpload = vi.fn().mockResolvedValue({
    document: { id: "document-id" },
  });
  const authorizeDocumentDownload = vi.fn().mockResolvedValue({
    download: {
      expiresAt: "2099-01-01T00:00:00.000Z",
      headers: {},
      method: "GET",
      url: "/api/document-transfers/download/one-use-token",
    },
  });
  const api = {
    authorizeDocumentDownload,
    authorizeDocumentUpload,
    finalizeDocumentUpload,
    withSignal: vi.fn(),
  };
  api.withSignal.mockReturnValue(api);
  const platform = {
    choose: vi.fn().mockResolvedValue(file),
    read: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
    upload: vi.fn().mockReturnValue(resolvedTask({ statusCode: 204 })),
    download: vi
      .fn()
      .mockReturnValue(
        resolvedTask({ statusCode: 200, tempFilePath: "wxfile://download" }),
      ),
    open: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } satisfies NativeFilePlatform;
  return {
    api,
    files: new NativeFiles(
      api as unknown as LivTalesApiClient,
      "https://api.example.test",
      () => credential,
      platform,
    ),
    platform,
  };
}

describe("native Files transfer", () => {
  it("hashes selected bytes, uploads only to the API ticket, and finalizes", async () => {
    const { api, files, platform } = harness();
    await files.attach("event-id", file, new AbortController().signal);
    expect(api.authorizeDocumentUpload).toHaveBeenCalledWith({
      checksumSha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      mimeType: "application/pdf",
      originalFilename: "brief.pdf",
      parentObjectId: "event-id",
      sizeBytes: 3,
      transferMode: "multipart",
    });
    expect(platform.upload).toHaveBeenCalledWith({
      filePath: file.path,
      headers: {},
      url: "https://api.example.test/api/document-transfers/upload-file/one-use-token",
    });
    expect(api.finalizeDocumentUpload).toHaveBeenCalledWith("authorization-id");
    expect(platform.remove).toHaveBeenCalledWith(file.path);
  });

  it("rejects oversize files locally and removes the temporary selection", async () => {
    const { api, files, platform } = harness();
    await expect(
      files.attach(
        "event-id",
        { ...file, size: maximumNativeDocumentSizeBytes + 1 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "payload_too_large" });
    expect(api.authorizeDocumentUpload).not.toHaveBeenCalled();
    expect(platform.remove).toHaveBeenCalledWith(file.path);
  });

  it("aborts an in-flight upload without finalizing", async () => {
    const { api, files, platform } = harness();
    const abort = vi.fn();
    platform.upload.mockReturnValue(
      Object.assign(new Promise<{ statusCode: number }>(() => undefined), {
        abort,
      }),
    );
    const controller = new AbortController();
    const attaching = files.attach("event-id", file, controller.signal);
    await vi.waitFor(() => expect(platform.upload).toHaveBeenCalled());
    controller.abort();
    await expect(attaching).rejects.toMatchObject({ kind: "aborted" });
    expect(abort).toHaveBeenCalledOnce();
    expect(api.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(platform.remove).toHaveBeenCalledWith(file.path);
  });

  it("authorizes each download and removes its temporary copy on cleanup", async () => {
    const { api, files, platform } = harness();
    await files.open("document-id", "brief.pdf", new AbortController().signal);
    expect(api.authorizeDocumentDownload).toHaveBeenCalledWith("document-id");
    expect(platform.download).toHaveBeenCalledWith({
      headers: {},
      url: "https://api.example.test/api/document-transfers/download/one-use-token",
    });
    expect(platform.open).toHaveBeenCalledWith(
      "wxfile://download",
      "brief.pdf",
    );
    await files.cleanup();
    expect(platform.remove).toHaveBeenCalledWith("wxfile://download");
  });

  it("aborts a download before opening a file", async () => {
    const { files, platform } = harness();
    const abort = vi.fn();
    platform.download.mockReturnValue(
      Object.assign(
        new Promise<{ statusCode: number; tempFilePath: string }>(
          () => undefined,
        ),
        { abort },
      ),
    );
    const controller = new AbortController();
    const opening = files.open("document-id", "brief.pdf", controller.signal);
    await vi.waitFor(() => expect(platform.download).toHaveBeenCalled());
    controller.abort();
    await expect(opening).rejects.toMatchObject({ kind: "aborted" });
    expect(abort).toHaveBeenCalledOnce();
    expect(platform.open).not.toHaveBeenCalled();
  });
});

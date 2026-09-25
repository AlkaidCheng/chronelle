import {
  ApiClientError,
  TransportError,
  type ApiCredential,
  type ChronelleApiClient,
} from "@livtales/api-client";
import {
  maximumNativeDocumentSizeBytes,
  type DocumentAttachmentResponse,
} from "@livtales/schemas";

import { sha256Hex } from "./sha256";

export interface SelectedFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
}

export interface NativeTask<Result> extends Promise<Result> {
  abort(): void;
}

export interface NativeFilePlatform {
  choose(): Promise<SelectedFile>;
  read(path: string): Promise<ArrayBuffer>;
  upload(input: {
    readonly filePath: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly url: string;
  }): NativeTask<{ readonly statusCode: number }>;
  download(input: {
    readonly headers: Readonly<Record<string, string>>;
    readonly url: string;
  }): NativeTask<{
    readonly statusCode: number;
    readonly tempFilePath: string;
  }>;
  open(path: string, filename: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const transferTimeoutMs = 120_000;

function currentCredential(
  getCredential: () => ApiCredential | null,
  original: ApiCredential | null,
  signal: AbortSignal,
): void {
  const current = getCredential();
  if (
    signal.aborted ||
    current?.accessToken !== original?.accessToken ||
    current?.workspaceId !== original?.workspaceId
  ) {
    throw new TransportError("aborted", "The client session changed.");
  }
}

function mimeType(filename: string): string {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  const known: Record<string, string> = {
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return known[extension ?? ""] ?? "application/octet-stream";
}

async function controlledTask<Result>(
  start: () => NativeTask<Result>,
  signal: AbortSignal,
): Promise<Result> {
  if (signal.aborted) {
    throw new TransportError("aborted", "The request was cancelled.");
  }
  const task = start();
  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      task.abort();
      finish(() =>
        reject(new TransportError("aborted", "The request was cancelled.")),
      );
    };
    const timer = setTimeout(() => {
      task.abort();
      finish(() =>
        reject(new TransportError("timeout", "The request timed out.")),
      );
    }, transferTimeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void task.then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export class NativeFiles {
  readonly #api: ChronelleApiClient;
  readonly #baseUrl: string;
  readonly #getCredential: () => ApiCredential | null;
  readonly #platform: NativeFilePlatform;
  readonly #temporaryFiles = new Set<string>();

  constructor(
    api: ChronelleApiClient,
    baseUrl: string,
    getCredential: () => ApiCredential | null,
    platform: NativeFilePlatform,
  ) {
    this.#api = api;
    this.#baseUrl = baseUrl;
    this.#getCredential = getCredential;
    this.#platform = platform;
  }

  choose(): Promise<SelectedFile> {
    return this.#platform.choose();
  }

  async attach(
    parentObjectId: string,
    file: SelectedFile,
    signal: AbortSignal,
  ): Promise<DocumentAttachmentResponse> {
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new ApiClientError(400, "invalid_request", "Invalid file size.");
      }
      if (file.size > maximumNativeDocumentSizeBytes) {
        throw new ApiClientError(
          413,
          "payload_too_large",
          "The file exceeds the Mini Program attachment limit.",
        );
      }
      const credential = this.#getCredential();
      const client = this.#api.withSignal(signal);
      const bytes = await this.#platform.read(file.path);
      currentCredential(this.#getCredential, credential, signal);
      if (bytes.byteLength !== file.size) {
        throw new ApiClientError(
          400,
          "invalid_request",
          "The file size changed.",
        );
      }
      const authorization = await client.authorizeDocumentUpload({
        checksumSha256: sha256Hex(bytes),
        mimeType: mimeType(file.name),
        originalFilename: file.name,
        parentObjectId,
        sizeBytes: file.size,
        transferMode: "multipart",
      });
      const uploadUrl = new URL(authorization.upload.url, this.#baseUrl);
      if (
        authorization.upload.method !== "POST" ||
        uploadUrl.origin !== new URL(this.#baseUrl).origin ||
        !/^\/api\/document-transfers\/upload-file\/[A-Za-z0-9_-]+$/u.test(
          uploadUrl.pathname,
        ) ||
        Date.parse(authorization.upload.expiresAt) <= Date.now()
      ) {
        throw new ApiClientError(
          0,
          "invalid_response",
          "The upload authorization is invalid.",
        );
      }
      currentCredential(this.#getCredential, credential, signal);
      const result = await controlledTask(
        () =>
          this.#platform.upload({
            filePath: file.path,
            headers: authorization.upload.headers,
            url: uploadUrl.toString(),
          }),
        signal,
      );
      currentCredential(this.#getCredential, credential, signal);
      if (result.statusCode !== 204) {
        throw new ApiClientError(
          result.statusCode,
          "request_failed",
          "The file upload failed.",
        );
      }
      return await client.finalizeDocumentUpload(authorization.id);
    } finally {
      await this.#platform.remove(file.path).catch(() => undefined);
    }
  }

  async open(
    documentId: string,
    filename: string,
    signal: AbortSignal,
  ): Promise<void> {
    const credential = this.#getCredential();
    const client = this.#api.withSignal(signal);
    const authorization = await client.authorizeDocumentDownload(documentId);
    if (Date.parse(authorization.download.expiresAt) <= Date.now()) {
      throw new ApiClientError(
        0,
        "invalid_response",
        "The download authorization expired.",
      );
    }
    currentCredential(this.#getCredential, credential, signal);
    const url = new URL(authorization.download.url, this.#baseUrl);
    if (
      url.protocol !== "https:" &&
      url.origin !== new URL(this.#baseUrl).origin
    ) {
      throw new ApiClientError(0, "invalid_response", "Invalid download URL.");
    }
    const result = await controlledTask(
      () =>
        this.#platform.download({
          headers: authorization.download.headers,
          url: url.toString(),
        }),
      signal,
    );
    if (result.tempFilePath) this.#temporaryFiles.add(result.tempFilePath);
    try {
      currentCredential(this.#getCredential, credential, signal);
      if (result.statusCode !== 200 || !result.tempFilePath) {
        throw new ApiClientError(
          result.statusCode,
          "request_failed",
          "The file download failed.",
        );
      }
      await this.#platform.open(result.tempFilePath, filename);
    } catch (error) {
      if (result.tempFilePath) {
        this.#temporaryFiles.delete(result.tempFilePath);
        await this.#platform.remove(result.tempFilePath).catch(() => undefined);
      }
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    const paths = [...this.#temporaryFiles];
    this.#temporaryFiles.clear();
    await Promise.all(
      paths.map((path) => this.#platform.remove(path).catch(() => undefined)),
    );
  }
}

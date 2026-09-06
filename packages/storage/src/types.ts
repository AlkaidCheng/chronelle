export interface StoredObjectMetadata {
  readonly checksumSha256: string;
  readonly sizeBytes: number;
}

export interface StorageTransferAuthorization {
  readonly expiresAt: Date;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET" | "PUT";
  readonly url: string;
}

export interface UploadAuthorizationInput {
  readonly checksumSha256: string;
  readonly credential: string;
  readonly expiresAt: Date;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
}

export interface DownloadAuthorizationInput {
  readonly credential: string;
  readonly expiresAt: Date;
  readonly mimeType: string;
  readonly originalFilename: string;
  readonly storageKey: string;
}

export interface StorageProvider {
  readonly encryptionMode: string;
  readonly providerId: string;

  createDownloadAuthorization(
    input: DownloadAuthorizationInput,
  ): Promise<StorageTransferAuthorization>;

  createUploadAuthorization(
    input: UploadAuthorizationInput,
  ): Promise<StorageTransferAuthorization>;

  inspectObject(storageKey: string): Promise<StoredObjectMetadata>;

  /** Enumerates immediate entries without following links or reading content. */
  listObjects?(
    prefix: string,
    signal: AbortSignal,
  ): AsyncIterable<StorageInventoryEntry>;
}

export interface StorageInventoryEntry {
  readonly storageKey: string;
  readonly kind: "file" | "unsupported";
}

export interface StorageTransferProvider extends StorageProvider {
  readObject(storageKey: string): Promise<Uint8Array>;

  writeObject(
    storageKey: string,
    bytes: Uint8Array,
    expected: StoredObjectMetadata,
  ): Promise<void>;
}

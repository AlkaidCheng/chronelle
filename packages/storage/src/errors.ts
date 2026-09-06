export class StorageObjectUnavailableError extends Error {
  constructor() {
    super("The stored object is unavailable.");
    this.name = "StorageObjectUnavailableError";
  }
}

export class StorageObjectConflictError extends Error {
  constructor() {
    super("The storage key is already occupied by different content.");
    this.name = "StorageObjectConflictError";
  }
}

export class UnsafeStorageKeyError extends Error {
  constructor() {
    super("The storage key is unsafe.");
    this.name = "UnsafeStorageKeyError";
  }
}

export class StorageInventoryUnavailableError extends Error {
  constructor() {
    super("The storage inventory could not be completed.");
    this.name = "StorageInventoryUnavailableError";
  }
}

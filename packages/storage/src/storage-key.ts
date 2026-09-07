import { UnsafeStorageKeyError } from "./errors.js";

const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeStorageKey(storageKey: string): void {
  if (storageKey.split("/").some((segment) => !safeSegment.test(segment))) {
    throw new UnsafeStorageKeyError();
  }
}

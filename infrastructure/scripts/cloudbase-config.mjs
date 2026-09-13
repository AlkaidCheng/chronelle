import { assertCloudBaseApiKeyFresh } from "../../packages/db/dist/index.js";

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export function readRequestTimeout(
  value = process.env.CLOUDBASE_REQUEST_TIMEOUT_MS,
) {
  const timeoutMs = Number(value ?? 30_000);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      "CLOUDBASE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000.",
    );
  }
  return timeoutMs;
}

export function assertApiKeyFresh(value) {
  assertCloudBaseApiKeyFresh(value);
}

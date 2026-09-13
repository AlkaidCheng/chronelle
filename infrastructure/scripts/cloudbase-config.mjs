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

const MAX_PAGE_LIMIT = 50;

/** Page size for the read-contract harness; small values exercise cursor paging on a small fixture. */
export function readPageLimit(
  value = process.env.CLOUDBASE_CONTRACT_PAGE_LIMIT,
) {
  const limit = Number(value ?? MAX_PAGE_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error(
      "CLOUDBASE_CONTRACT_PAGE_LIMIT must be an integer between 1 and 50.",
    );
  }
  return limit;
}

export function assertApiKeyFresh(value) {
  assertCloudBaseApiKeyFresh(value);
}

/** Exits once buffered stdout/stderr have been written; the SDK otherwise keeps the process alive. */
export function exitAfterFlush(code) {
  process.stderr.write("", () => {
    process.stdout.write("", () => process.exit(code));
  });
}

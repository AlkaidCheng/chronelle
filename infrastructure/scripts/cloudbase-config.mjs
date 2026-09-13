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
  const payload = readJwtPayload(value);
  if (payload === undefined || typeof payload.exp !== "number") return;
  if (payload.exp * 1000 <= Date.now()) {
    throw new Error(
      "CLOUDBASE_APIKEY is expired. Replace it with a fresh short-lived server key and retry.",
    );
  }
}

function readJwtPayload(value) {
  const segment = value.split(".")[1];
  if (!segment) return undefined;
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

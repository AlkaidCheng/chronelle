import { createHash, createHmac } from "node:crypto";

/** A Tencent Cloud API key (CAM SecretId and SecretKey). */
export interface TencentCloudCredential {
  readonly secretId: string;
  readonly secretKey: string;
}

/** One call to a Tencent Cloud API 3.0 action. */
export interface TencentCloudRequest {
  readonly service: string;
  readonly host: string;
  readonly action: string;
  readonly version: string;
  readonly region: string;
  readonly payload: string;
  /** Unix seconds; the signature is valid for five minutes around it. */
  readonly timestamp: number;
}

const contentType = "application/json; charset=utf-8";
const signedHeaders = "content-type;host;x-tc-action";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value, "utf8").digest();

/**
 * The TC3-HMAC-SHA256 signature of a POST with a JSON body, as Tencent
 * Cloud's API 3.0 defines it: the canonical request, the string to sign, and
 * the Authorization header.
 */
export function signTencentCloudRequest(
  credential: TencentCloudCredential,
  request: TencentCloudRequest,
): {
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly authorization: string;
} {
  const date = new Date(request.timestamp * 1_000).toISOString().slice(0, 10);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:${contentType}\nhost:${request.host}\nx-tc-action:${request.action.toLowerCase()}\n`,
    signedHeaders,
    sha256(request.payload),
  ].join("\n");
  const scope = `${date}/${request.service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(request.timestamp),
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signing = hmac(
    hmac(hmac(`TC3${credential.secretKey}`, date), request.service),
    "tc3_request",
  );
  const signature = createHmac("sha256", signing)
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    canonicalRequest,
    stringToSign,
    authorization: `TC3-HMAC-SHA256 Credential=${credential.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** A Tencent Cloud API error, with the code the API returned. */
export class TencentCloudApiError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(code: string, message: string, requestId?: string) {
    super(`${code}: ${message}`);
    this.name = "TencentCloudApiError";
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Calls one Tencent Cloud API 3.0 action and returns its `Response` object;
 * an error in the response throws `TencentCloudApiError`.
 */
export async function callTencentCloud(
  credential: TencentCloudCredential,
  request: Omit<TencentCloudRequest, "payload" | "timestamp"> & {
    readonly body: unknown;
  },
  options: {
    readonly fetch?: typeof fetch;
    readonly now?: () => Date;
    readonly timeoutMs?: number;
  } = {},
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(request.body);
  const timestamp = Math.floor(
    (options.now ?? (() => new Date()))().getTime() / 1_000,
  );
  const { authorization } = signTencentCloudRequest(credential, {
    ...request,
    payload,
    timestamp,
  });
  const response = await (options.fetch ?? fetch)(`https://${request.host}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      Host: request.host,
      "X-TC-Action": request.action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": request.version,
      "X-TC-Region": request.region,
    },
    body: payload,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  const parsed = (await response.json().catch(() => null)) as {
    Response?: Record<string, unknown> & {
      Error?: { Code?: string; Message?: string };
      RequestId?: string;
    };
  } | null;
  const result = parsed?.Response;
  if (result === undefined)
    throw new TencentCloudApiError(
      "InvalidResponse",
      `${request.action} returned HTTP ${response.status} without a Response`,
    );
  if (result.Error !== undefined)
    throw new TencentCloudApiError(
      result.Error.Code ?? "UnknownError",
      result.Error.Message ?? "",
      result.RequestId,
    );
  return result;
}

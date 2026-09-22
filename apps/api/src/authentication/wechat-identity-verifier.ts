import { IdentityProviderUnavailableError } from "../errors.js";

/** A CloudBase identity after its bearer token has been checked remotely. */
export interface VerifiedWeChatIdentity {
  readonly provider: typeof cloudBaseWeChatIdentityProvider;
  /** Environment-qualified CloudBase user id; never an unscoped OpenID. */
  readonly subject: string;
  readonly expiresAt: Date;
}

export interface WeChatIdentityVerifier {
  verify(
    accessToken: string,
    deviceId?: string | undefined,
  ): Promise<VerifiedWeChatIdentity | null>;
}

export const cloudBaseWeChatIdentityProvider = "cloudbase-wechat";
export const defaultCloudBaseTokenTtlMs = 2 * 60 * 60 * 1_000;

const maximumProfileBytes = 64 * 1_024;
const defaultProviderIds = ["wechat", "weixin", "wx", "wx_openid"];
const environmentIdShape = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/u;

export interface CloudBaseWeChatIdentityVerifierOptions {
  readonly envId: string;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly providerIds?: readonly string[] | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly clock?: (() => Date) | undefined;
}

/**
 * Verifies a CloudBase end-user token with the documented user/me endpoint.
 * The response must contain a WeChat provider; profile fields are otherwise
 * ignored and the raw bearer credential is never returned or logged.
 */
export class CloudBaseWeChatIdentityVerifier implements WeChatIdentityVerifier {
  readonly #clock: () => Date;
  readonly #endpoint: string;
  readonly #environmentId: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #providerIds: ReadonlySet<string>;
  readonly #requestTimeoutMs: number;

  constructor(options: CloudBaseWeChatIdentityVerifierOptions) {
    if (!environmentIdShape.test(options.envId)) {
      throw new TypeError("CloudBase environment id is invalid.");
    }
    const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new TypeError("CloudBase auth timeout must be a positive integer.");
    }
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("CloudBase auth requires fetch.");
    }
    const providerIds = (options.providerIds ?? defaultProviderIds)
      .map((provider) => provider.trim().toLowerCase())
      .filter((provider) => provider.length > 0);
    if (providerIds.length === 0) {
      throw new TypeError("At least one WeChat provider id is required.");
    }
    this.#clock = options.clock ?? (() => new Date());
    this.#environmentId = options.envId;
    this.#endpoint = `https://${options.envId}.api.tcloudbasegateway.com/auth/v1/user/me?client_id=${encodeURIComponent(options.envId)}`;
    this.#fetch = fetchImplementation;
    this.#providerIds = new Set(providerIds);
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  async verify(
    accessToken: string,
    deviceId?: string | undefined,
  ): Promise<VerifiedWeChatIdentity | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(deviceId === undefined ? {} : { "x-device-id": deviceId }),
        },
        signal: controller.signal,
      });
      if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403
      ) {
        return null;
      }
      if (!response.ok) throw new IdentityProviderUnavailableError();
      const body = await readBoundedBody(response);
      if (body === null) return null;
      return this.#parseProfile(body, accessToken);
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) throw error;
      throw new IdentityProviderUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }

  #parseProfile(
    body: string,
    accessToken: string,
  ): VerifiedWeChatIdentity | null {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const profile = value as Record<string, unknown>;
    const subject = profile.sub;
    if (
      typeof subject !== "string" ||
      subject.length === 0 ||
      subject.length > 256 ||
      profile.status !== "ACTIVE" ||
      !this.#hasWeChatProvider(profile.providers)
    ) {
      return null;
    }
    const now = this.#clock();
    const expiresAt =
      tokenExpiry(accessToken) ??
      new Date(now.getTime() + defaultCloudBaseTokenTtlMs);
    if (expiresAt.getTime() <= now.getTime()) return null;
    return {
      provider: cloudBaseWeChatIdentityProvider,
      subject: `${this.#environmentId}:${subject}`,
      expiresAt,
    };
  }

  #hasWeChatProvider(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.some((provider) => {
        if (
          provider === null ||
          typeof provider !== "object" ||
          Array.isArray(provider)
        ) {
          return false;
        }
        const id = (provider as Record<string, unknown>).id;
        return (
          typeof id === "string" && this.#providerIds.has(id.toLowerCase())
        );
      })
    );
  }
}

async function readBoundedBody(response: Response): Promise<string | null> {
  const announcedLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(announcedLength) &&
    announcedLength > maximumProfileBytes
  ) {
    return null;
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return body + decoder.decode();
    bytes += chunk.value.byteLength;
    if (bytes > maximumProfileBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
}

/** Expiry is trusted only after CloudBase accepted the token. */
function tokenExpiry(accessToken: string): Date | null {
  const payload = accessToken.split(".")[1];
  if (payload === undefined) return null;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      exp?: unknown;
    };
    if (typeof value.exp !== "number" || !Number.isSafeInteger(value.exp)) {
      return null;
    }
    const date = new Date(value.exp * 1_000);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type JsonPayload =
  | { readonly readable: true; readonly value: unknown }
  | { readonly readable: false };

export interface JsonTransportRequest {
  readonly body?: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: HttpMethod;
  readonly signals: readonly AbortSignal[];
  readonly timeoutMs: number;
  readonly url: string;
}

export interface JsonTransportResponse {
  readonly payload: JsonPayload;
  readonly status: number;
}

export interface JsonTransport {
  request(input: JsonTransportRequest): Promise<JsonTransportResponse>;
}

export interface BinaryTransferRequest {
  readonly body?: ArrayBuffer | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: HttpMethod;
  readonly responseBody: "bytes" | "none";
  readonly signals: readonly AbortSignal[];
  readonly timeoutMs: number;
  readonly url: string;
}

export interface BinaryTransferResponse {
  readonly bytes: ArrayBuffer | null;
  readonly errorPayload: JsonPayload | null;
  readonly status: number;
}

export interface BinaryTransfer {
  request(input: BinaryTransferRequest): Promise<BinaryTransferResponse>;
}

export interface FileHasher {
  sha256Hex(bytes: ArrayBuffer): Promise<string>;
}

export type TransportErrorKind = "aborted" | "network" | "timeout";

export class TransportError extends Error {
  readonly kind: TransportErrorKind;

  constructor(kind: TransportErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = kind === "aborted" ? "AbortError" : "TransportError";
    this.kind = kind;
  }
}

export function parseJsonPayload(value: unknown): JsonPayload {
  if (typeof value !== "string") {
    return value === undefined || value instanceof ArrayBuffer
      ? { readable: false }
      : { readable: true, value };
  }
  try {
    return { readable: true, value: JSON.parse(value) as unknown };
  } catch {
    return { readable: false };
  }
}

interface ControlledRequest {
  readonly signals: readonly AbortSignal[];
  readonly timeoutMs: number;
}

async function withRequestControl<Result>(
  request: ControlledRequest,
  run: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  if (request.signals.some((signal) => signal.aborted)) {
    throw new TransportError("aborted", "The request was cancelled.");
  }

  const controller = new AbortController();
  let timedOut = false;
  const listeners = request.signals.map((signal) => {
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    return { abort, signal };
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);

  try {
    const result = await run(controller.signal);
    if (request.signals.some((signal) => signal.aborted)) {
      throw new TransportError("aborted", "The request was cancelled.");
    }
    if (timedOut) {
      throw new TransportError("timeout", "The request timed out.");
    }
    return result;
  } catch (error) {
    if (error instanceof TransportError) throw error;
    if (request.signals.some((signal) => signal.aborted)) {
      throw new TransportError("aborted", "The request was cancelled.", error);
    }
    if (timedOut) {
      throw new TransportError("timeout", "The request timed out.", error);
    }
    throw new TransportError("network", "The request failed.", error);
  } finally {
    clearTimeout(timer);
    for (const { abort, signal } of listeners) {
      signal.removeEventListener("abort", abort);
    }
  }
}

function fetchOptions(
  request: JsonTransportRequest | BinaryTransferRequest,
  signal: AbortSignal,
): RequestInit {
  return {
    ...(request.body === undefined ? {} : { body: request.body }),
    headers: new Headers(request.headers),
    method: request.method,
    signal,
  };
}

export function createFetchJsonTransport(
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch.bind(
    globalThis,
  ),
): JsonTransport {
  return {
    request: (input) =>
      withRequestControl(input, async (signal) => {
        const response = await fetchImplementation(
          input.url,
          fetchOptions(input, signal),
        );
        let payload: JsonPayload;
        try {
          payload = { readable: true, value: await response.json() };
        } catch (error) {
          if (signal.aborted) throw error;
          payload = { readable: false };
        }
        return {
          payload,
          status: response.status,
        };
      }),
  };
}

export function createFetchBinaryTransfer(
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch.bind(
    globalThis,
  ),
): BinaryTransfer {
  return {
    request: (input) =>
      withRequestControl(input, async (signal) => {
        const response = await fetchImplementation(
          input.url,
          fetchOptions(input, signal),
        );
        if (!response.ok) {
          return {
            bytes: null,
            errorPayload: parseJsonPayload(await response.text()),
            status: response.status,
          };
        }
        return {
          bytes:
            input.responseBody === "bytes"
              ? await response.arrayBuffer()
              : null,
          errorPayload: null,
          status: response.status,
        };
      }),
  };
}

export function createWebCryptoFileHasher(
  cryptoImplementation: Pick<Crypto, "subtle"> = globalThis.crypto,
): FileHasher {
  return {
    async sha256Hex(bytes) {
      const digest = await cryptoImplementation.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
  };
}

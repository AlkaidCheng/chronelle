import {
  parseJsonPayload,
  TransportError,
  type HttpMethod,
  type JsonTransport,
  type JsonTransportRequest,
} from "@chronelle/api-client";

export interface TaroRequestOptions {
  readonly body?: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: HttpMethod;
  readonly timeoutMs: number;
  readonly url: string;
}

export interface TaroRequestResult {
  readonly data: unknown;
  readonly statusCode: number;
}

export interface TaroRequestTask extends Promise<TaroRequestResult> {
  abort(): void;
}

export type TaroRequest = (options: TaroRequestOptions) => TaroRequestTask;

function isTimeoutFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errMsg" in error &&
    typeof error.errMsg === "string" &&
    error.errMsg.toLowerCase().includes("timeout")
  );
}

async function requestJson(request: TaroRequest, input: JsonTransportRequest) {
  if (input.signals.some((signal) => signal.aborted)) {
    throw new TransportError("aborted", "The request was cancelled.");
  }

  let timedOut = false;
  const task = request({
    body: input.body,
    headers: input.headers,
    method: input.method,
    timeoutMs: input.timeoutMs,
    url: input.url,
  });
  const abort = () => task.abort();
  for (const signal of input.signals) {
    signal.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    task.abort();
  }, input.timeoutMs);

  try {
    const response = await task;
    if (input.signals.some((signal) => signal.aborted)) {
      throw new TransportError("aborted", "The request was cancelled.");
    }
    if (timedOut) {
      throw new TransportError("timeout", "The request timed out.");
    }
    return {
      payload: parseJsonPayload(response.data),
      status: response.statusCode,
    };
  } catch (error) {
    if (error instanceof TransportError) throw error;
    if (input.signals.some((signal) => signal.aborted)) {
      throw new TransportError("aborted", "The request was cancelled.", error);
    }
    if (timedOut || isTimeoutFailure(error)) {
      throw new TransportError("timeout", "The request timed out.", error);
    }
    throw new TransportError("network", "The request failed.", error);
  } finally {
    clearTimeout(timer);
    for (const signal of input.signals) {
      signal.removeEventListener("abort", abort);
    }
  }
}

export function createTaroJsonTransport(request: TaroRequest): JsonTransport {
  return { request: (input) => requestJson(request, input) };
}

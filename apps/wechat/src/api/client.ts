import { LivTalesApiClient, type ApiCredential } from "@livtales/api-client";

import { createTaroJsonTransport, type TaroRequest } from "./taro-transport";

export interface WeChatApiClientOptions {
  readonly baseUrl: string;
  readonly getCredential?: (() => ApiCredential | null) | undefined;
  readonly request: TaroRequest;
  readonly requestTimeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export function createWeChatApiClient(
  options: WeChatApiClientOptions,
): LivTalesApiClient {
  return new LivTalesApiClient({
    baseUrl: options.baseUrl,
    getCredential: options.getCredential,
    requestTimeoutMs: options.requestTimeoutMs,
    signal: options.signal,
    transport: createTaroJsonTransport(options.request),
  });
}

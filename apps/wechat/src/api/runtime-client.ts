import type { ApiCredential, LivTalesApiClient } from "@livtales/api-client";
import Taro from "@tarojs/taro";

import { createWeChatApiClient } from "./client";
import type {
  TaroRequest,
  TaroRequestOptions,
  TaroRequestTask,
} from "./taro-transport";

const taroRequest: TaroRequest = (options: TaroRequestOptions) =>
  Taro.request({
    data: options.body,
    dataType: "other",
    header: options.headers,
    method: options.method,
    responseType: "text",
    timeout: options.timeoutMs,
    url: options.url,
  }) as TaroRequestTask;

export interface RuntimeApiClientOptions {
  readonly baseUrl: string;
  readonly getCredential?: (() => ApiCredential | null) | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export function createRuntimeApiClient(
  options: RuntimeApiClientOptions,
): LivTalesApiClient {
  return createWeChatApiClient({ ...options, request: taroRequest });
}

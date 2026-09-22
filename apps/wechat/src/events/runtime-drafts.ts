import Taro from "@tarojs/taro";

import type { TaroStorage } from "../auth/session-store";
import { uuidV4FromBytes } from "./command-id";
import { EventDraftStore } from "./draft-store";

const taroStorage: TaroStorage = {
  getStorage: (options) => Taro.getStorage(options),
  setStorage: (options) => Taro.setStorage(options),
  removeStorage: (options) => Taro.removeStorage(options),
};

export function createRuntimeEventDraftStore(): EventDraftStore {
  return new EventDraftStore(taroStorage);
}

export async function createRuntimeCommandId(): Promise<string> {
  const result = await Taro.getRandomValues({ length: 16 });
  return uuidV4FromBytes(new Uint8Array(result.randomValues));
}

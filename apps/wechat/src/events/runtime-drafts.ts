import Taro from "@tarojs/taro";

import { taroStorage } from "../runtime/taro-storage";
import { uuidV4FromBytes } from "./command-id";
import { EventDraftStore } from "./draft-store";

export function createRuntimeEventDraftStore(): EventDraftStore {
  return new EventDraftStore(taroStorage);
}

export async function createRuntimeCommandId(): Promise<string> {
  const result = await Taro.getRandomValues({ length: 16 });
  return uuidV4FromBytes(new Uint8Array(result.randomValues));
}

import Taro from "@tarojs/taro";

import { type TaroStorage, WeChatSessionStore } from "./session-store";

const taroStorage: TaroStorage = {
  getStorage: (options) => Taro.getStorage(options),
  setStorage: (options) => Taro.setStorage(options),
  removeStorage: (options) => Taro.removeStorage(options),
};

export function createRuntimeSessionStore(): WeChatSessionStore {
  return new WeChatSessionStore(taroStorage);
}

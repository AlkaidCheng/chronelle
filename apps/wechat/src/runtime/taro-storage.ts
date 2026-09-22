import Taro from "@tarojs/taro";

import type { TaroStorage } from "../auth/session-store";

export const taroStorage: TaroStorage = {
  getStorage: (options) => Taro.getStorage(options),
  removeStorage: (options) => Taro.removeStorage(options),
  setStorage: (options) => Taro.setStorage(options),
};

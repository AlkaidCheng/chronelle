import cloudbase from "@cloudbase/js-sdk/app";
import { registerAuth } from "@cloudbase/js-sdk/auth";
import Taro from "@tarojs/taro";

import {
  type CloudBaseAuthPort,
  CloudBaseWeChatIdentity,
} from "./cloudbase-identity";

let authRegistered = false;

export function createRuntimeCloudBaseIdentity(
  environmentId: string,
  useWxCloud: boolean,
): CloudBaseWeChatIdentity {
  if (!authRegistered) {
    registerAuth(cloudbase);
    authRegistered = true;
  }
  if (useWxCloud) Taro.cloud.init({ env: environmentId, traceUser: true });
  const app = cloudbase.init({ env: environmentId });
  const auth = app.auth({
    persistence: "none",
  }) as unknown as CloudBaseAuthPort;
  return new CloudBaseWeChatIdentity(auth, useWxCloud);
}

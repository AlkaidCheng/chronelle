export interface WeChatRuntimeConfig {
  readonly apiBaseUrl: string;
  readonly cloudBaseEnvId: string;
  readonly useWxCloud: boolean;
}

export type RuntimeConfigResult =
  | { readonly ok: true; readonly value: WeChatRuntimeConfig }
  | { readonly ok: false; readonly reason: string };

interface RuntimeEnvironment {
  readonly apiBaseUrl?: string | undefined;
  readonly cloudBaseEnvId?: string | undefined;
  readonly useWxCloud?: string | undefined;
}

export function parseRuntimeConfig(
  environment: RuntimeEnvironment,
): RuntimeConfigResult {
  const apiBaseUrl = environment.apiBaseUrl?.trim();
  const cloudBaseEnvId = environment.cloudBaseEnvId?.trim();
  if (apiBaseUrl === undefined || apiBaseUrl.length === 0) {
    return { ok: false, reason: "missing-api-origin" };
  }
  if (cloudBaseEnvId === undefined || cloudBaseEnvId.length === 0) {
    return { ok: false, reason: "missing-cloudbase-environment" };
  }

  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return { ok: false, reason: "invalid-api-origin" };
  }
  const localDevelopment =
    url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" &&
      !(localDevelopment && url.protocol === "http:")) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return { ok: false, reason: "invalid-api-origin" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,127}$/u.test(cloudBaseEnvId)) {
    return { ok: false, reason: "invalid-cloudbase-environment" };
  }
  if (
    environment.useWxCloud !== undefined &&
    environment.useWxCloud !== "true" &&
    environment.useWxCloud !== "false"
  ) {
    return { ok: false, reason: "invalid-wx-cloud-mode" };
  }

  return {
    ok: true,
    value: {
      apiBaseUrl: url.toString().replace(/\/$/u, ""),
      cloudBaseEnvId,
      useWxCloud: environment.useWxCloud === "true",
    },
  };
}

export function readRuntimeConfig(): RuntimeConfigResult {
  return parseRuntimeConfig({
    apiBaseUrl: process.env.TARO_APP_API_BASE_URL,
    cloudBaseEnvId: process.env.TARO_APP_CLOUDBASE_ENV_ID,
    useWxCloud: process.env.TARO_APP_CLOUDBASE_USE_WX_CLOUD,
  });
}

import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseRuntimeConfig } from "../src/runtime/config";

const permittedBuildVariables = new Set([
  "TARO_APP_ID",
  "TARO_APP_API_BASE_URL",
  "TARO_APP_CLOUDBASE_ENV_ID",
  "TARO_APP_CLOUDBASE_USE_WX_CLOUD",
]);

export interface ReleasePreflightResult {
  readonly appId: string;
  readonly apiOrigin: string;
}

export function inspectReleaseInputs(
  environment: Readonly<Record<string, string | undefined>>,
): ReleasePreflightResult {
  const unexpected = Object.keys(environment).filter(
    (name) =>
      name.startsWith("TARO_APP_") && !permittedBuildVariables.has(name),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unreviewed Mini Program build variables: ${unexpected.sort().join(", ")}`,
    );
  }

  const appId = environment.TARO_APP_ID?.trim() ?? "";
  if (!/^wx[0-9a-f]{16}$/u.test(appId)) {
    throw new Error("TARO_APP_ID must use the WeChat Mini Program format.");
  }
  if (environment.TARO_APP_CLOUDBASE_USE_WX_CLOUD === undefined) {
    throw new Error("TARO_APP_CLOUDBASE_USE_WX_CLOUD must be explicit.");
  }

  const configured = parseRuntimeConfig({
    apiBaseUrl: environment.TARO_APP_API_BASE_URL,
    cloudBaseEnvId: environment.TARO_APP_CLOUDBASE_ENV_ID,
    useWxCloud: environment.TARO_APP_CLOUDBASE_USE_WX_CLOUD,
  });
  if (!configured.ok) {
    throw new Error(
      `Invalid Mini Program runtime configuration: ${configured.reason}`,
    );
  }

  const apiUrl = new URL(configured.value.apiBaseUrl);
  const hostname = apiUrl.hostname.toLowerCase();
  if (
    apiUrl.protocol !== "https:" ||
    apiUrl.pathname !== "/" ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname === "example.com" ||
    hostname.endsWith(".example.com") ||
    hostname === "example.net" ||
    hostname.endsWith(".example.net") ||
    hostname === "example.org" ||
    hostname.endsWith(".example.org")
  ) {
    throw new Error("TARO_APP_API_BASE_URL must be a public HTTPS origin.");
  }

  return { appId, apiOrigin: apiUrl.origin };
}

export function assertBuiltAppId(
  projectConfig: { readonly appid?: unknown },
  expectedAppId: string,
): void {
  if (projectConfig.appid !== expectedAppId) {
    throw new Error("The built Mini Program AppID does not match TARO_APP_ID.");
  }
}

async function main(): Promise<void> {
  const result = inspectReleaseInputs(process.env);
  const projectConfig = JSON.parse(
    await readFile(
      path.resolve(import.meta.dirname, "../dist/weapp/project.config.json"),
      "utf8",
    ),
  ) as { appid?: unknown };
  assertBuiltAppId(projectConfig, result.appId);
  console.log(
    `WeChat build-input preflight passed. API origin: ${result.apiOrigin}`,
  );
  console.log(
    "Verify WeChat request, upload, identity, and signed-download domains against staging traffic before submission.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}

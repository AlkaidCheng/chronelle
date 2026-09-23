import { describe, expect, it } from "vitest";

import {
  assertBuiltAppId,
  inspectReleaseInputs,
} from "../scripts/release-preflight";

const valid = {
  TARO_APP_ID: "wx0123456789abcdef",
  TARO_APP_API_BASE_URL: "https://api.chronelle.dev",
  TARO_APP_CLOUDBASE_ENV_ID: "chronelle-staging-a1b2c3",
  TARO_APP_CLOUDBASE_USE_WX_CLOUD: "false",
};

describe("Mini Program release preflight", () => {
  it("reports the API origin without exposing the CloudBase environment", () => {
    expect(inspectReleaseInputs(valid)).toEqual({
      appId: valid.TARO_APP_ID,
      apiOrigin: "https://api.chronelle.dev",
    });
  });

  it("requires an explicit AppID and CloudBase network mode", () => {
    expect(() =>
      inspectReleaseInputs({ ...valid, TARO_APP_ID: "touristappid" }),
    ).toThrow("TARO_APP_ID");
    expect(() =>
      inspectReleaseInputs({
        ...valid,
        TARO_APP_CLOUDBASE_USE_WX_CLOUD: undefined,
      }),
    ).toThrow("TARO_APP_CLOUDBASE_USE_WX_CLOUD");
  });

  it.each([
    "http://api.chronelle.dev",
    "https://localhost",
    "https://api.internal",
    "https://api",
    "https://127.0.0.1",
    "https://api.example.com",
    "https://api.chronelle.dev/prefix",
    "https://api.chronelle.dev?token=hidden",
  ])("rejects a non-release API origin: %s", (apiBaseUrl) => {
    expect(() =>
      inspectReleaseInputs({
        ...valid,
        TARO_APP_API_BASE_URL: apiBaseUrl,
      }),
    ).toThrow();
  });

  it("rejects unreviewed variables that Taro could embed in the bundle", () => {
    expect(() =>
      inspectReleaseInputs({
        ...valid,
        TARO_APP_SERVER_SECRET: "fixture-value",
      }),
    ).toThrow("TARO_APP_SERVER_SECRET");
  });

  it("checks the AppID emitted into the compiled project", () => {
    expect(() =>
      assertBuiltAppId({ appid: valid.TARO_APP_ID }, valid.TARO_APP_ID),
    ).not.toThrow();
    expect(() =>
      assertBuiltAppId({ appid: "touristappid" }, valid.TARO_APP_ID),
    ).toThrow("does not match");
  });
});

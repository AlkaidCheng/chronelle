import { describe, expect, it, vi } from "vitest";

import {
  type CloudBaseAuthPort,
  CloudBaseIdentityError,
  CloudBaseWeChatIdentity,
} from "../src/auth/cloudbase-identity";

function authDouble(
  sessionToken?: string,
  refreshedToken = "refreshed-cloudbase-access-token",
): CloudBaseAuthPort {
  return {
    signInWithOpenId: vi.fn(async () => ({
      data: { session: sessionToken ? { access_token: sessionToken } : null },
      error: null,
    })),
    getAccessToken: vi.fn(async () => ({
      accessToken: refreshedToken,
      env: "chronelle-staging",
    })),
  };
}

describe("CloudBase WeChat identity adapter", () => {
  it("returns the access token issued by silent OpenID sign-in", async () => {
    const auth = authDouble("embedded-cloudbase-access-token");
    const identity = new CloudBaseWeChatIdentity(auth, false);

    await expect(identity.getAccessToken()).resolves.toBe(
      "embedded-cloudbase-access-token",
    );
    expect(auth.signInWithOpenId).toHaveBeenCalledWith({ useWxCloud: false });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
  });

  it("falls back to the SDK token accessor", async () => {
    const auth = authDouble();
    const identity = new CloudBaseWeChatIdentity(auth, true);

    await expect(identity.getAccessToken()).resolves.toBe(
      "refreshed-cloudbase-access-token",
    );
    expect(auth.signInWithOpenId).toHaveBeenCalledWith({ useWxCloud: true });
  });

  it("uses a generic failure for provider errors and malformed tokens", async () => {
    const rejected = authDouble();
    rejected.signInWithOpenId = vi.fn(async () => ({
      data: {},
      error: { message: "sensitive provider detail" },
    }));
    await expect(
      new CloudBaseWeChatIdentity(rejected, false).getAccessToken(),
    ).rejects.toBeInstanceOf(CloudBaseIdentityError);

    await expect(
      new CloudBaseWeChatIdentity(
        authDouble(undefined, "short"),
        false,
      ).getAccessToken(),
    ).rejects.toBeInstanceOf(CloudBaseIdentityError);
  });
});

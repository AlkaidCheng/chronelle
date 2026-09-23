import { ApiClientError } from "@chronelle/api-client";
import { describe, expect, it } from "vitest";

import { passwordSignInNotice } from "../src/auth/sign-in-notice";

describe("password sign-in notices", () => {
  it.each([
    ["invalid_credentials", "invalidCredentials"],
    ["email_unverified", "emailUnverified"],
    ["credential_locked", "credentialLocked"],
    ["unexpected", "signInFailed"],
  ] as const)("maps %s to %s", (code, notice) => {
    expect(passwordSignInNotice(new ApiClientError(401, code, code))).toBe(
      notice,
    );
  });

  it("uses a generic notice for network failures", () => {
    expect(passwordSignInNotice(new Error("offline"))).toBe("signInFailed");
  });
});

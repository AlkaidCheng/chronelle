import { ApiClientError } from "@chronelle/api-client";

export type SignInNotice =
  | "sessionExpired"
  | "signInFailed"
  | "invalidCredentials"
  | "emailUnverified"
  | "credentialLocked"
  | "linkFailed"
  | "storageFailed";

export function passwordSignInNotice(error: unknown): SignInNotice {
  if (error instanceof ApiClientError) {
    if (error.code === "invalid_credentials") return "invalidCredentials";
    if (error.code === "email_unverified") return "emailUnverified";
    if (error.code === "credential_locked") return "credentialLocked";
  }
  return "signInFailed";
}

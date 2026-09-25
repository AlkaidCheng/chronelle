import type { DevelopmentSignInRequest } from "@livtales/schemas";

import type { AuthIdentity } from "./auth-provider.js";

/** The provider name development sign-ins are recorded under. */
export const developmentIdentityProvider = "development";

/** The identity a development sign-in asserts: the email is the subject. */
export function developmentIdentity(
  input: DevelopmentSignInRequest,
): AuthIdentity {
  return {
    displayName: input.displayName,
    email: input.email,
    provider: developmentIdentityProvider,
    subject: input.email,
  };
}

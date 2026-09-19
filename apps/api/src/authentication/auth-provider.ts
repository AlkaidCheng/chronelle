export interface AuthIdentity {
  readonly displayName: string;
  readonly email: string | null;
  readonly provider: string;
  readonly subject: string;
  /** The username sign-up chose; an account created without one gets one from its name. */
  readonly username?: string | undefined;
}

export interface AuthProvider {
  authenticate(accessToken: string): Promise<AuthIdentity | null>;
}

/** The identity provider of email and password accounts. */
export const passwordIdentityProvider = "password";

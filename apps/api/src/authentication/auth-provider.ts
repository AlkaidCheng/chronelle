export interface AuthIdentity {
  readonly displayName: string;
  readonly email: string | null;
  readonly provider: string;
  readonly subject: string;
}

export interface AuthProvider {
  authenticate(accessToken: string): Promise<AuthIdentity | null>;
}

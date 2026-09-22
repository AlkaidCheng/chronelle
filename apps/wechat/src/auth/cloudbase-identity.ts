interface CloudBaseAuthError {
  readonly message?: string | undefined;
}

export interface CloudBaseAuthPort {
  signInWithOpenId(input: { readonly useWxCloud: boolean }): Promise<{
    readonly data: {
      readonly session?:
        { readonly access_token?: string | undefined } | null | undefined;
    };
    readonly error: CloudBaseAuthError | null;
  }>;
  getAccessToken(): Promise<{
    readonly accessToken: string;
    readonly env: string;
  }>;
}

export class CloudBaseIdentityError extends Error {
  constructor() {
    super("CloudBase could not establish a WeChat identity.");
    this.name = "CloudBaseIdentityError";
  }
}

/** Obtains one short-lived CloudBase proof; callers must never persist it. */
export class CloudBaseWeChatIdentity {
  readonly #auth: CloudBaseAuthPort;
  readonly #useWxCloud: boolean;

  constructor(auth: CloudBaseAuthPort, useWxCloud: boolean) {
    this.#auth = auth;
    this.#useWxCloud = useWxCloud;
  }

  async getAccessToken(): Promise<string> {
    const result = await this.#auth.signInWithOpenId({
      useWxCloud: this.#useWxCloud,
    });
    if (result.error !== null) throw new CloudBaseIdentityError();

    const embedded = result.data.session?.access_token?.trim();
    if (embedded !== undefined && embedded.length >= 20) return embedded;

    const refreshed = (await this.#auth.getAccessToken()).accessToken.trim();
    if (refreshed.length < 20) throw new CloudBaseIdentityError();
    return refreshed;
  }
}

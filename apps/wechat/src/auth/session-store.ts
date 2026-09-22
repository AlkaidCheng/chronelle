import type { ApiCredential, ChronelleApiClient } from "@chronelle/api-client";

export const weChatSessionStorageKey = "chronelle.session.v1";

export interface TaroStorageResult {
  readonly data: unknown;
}

export interface TaroStorage {
  getStorage(options: { readonly key: string }): Promise<TaroStorageResult>;
  setStorage(options: {
    readonly key: string;
    readonly data: unknown;
  }): Promise<unknown>;
  removeStorage(options: { readonly key: string }): Promise<unknown>;
}

interface StoredSession {
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly expiresAt: string;
}

export interface SessionGrant {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly workspace: { readonly id: string };
}

export type SessionRevoker = Pick<
  ChronelleApiClient,
  "signOut" | "signOutEverywhere"
>;

/**
 * Owns the Mini Program's Chronelle bearer token. CloudBase credentials are
 * deliberately never accepted by this storage boundary.
 */
export class WeChatSessionStore {
  readonly #clock: () => Date;
  readonly #storage: TaroStorage;
  #credential: ApiCredential | null = null;

  constructor(storage: TaroStorage, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#storage = storage;
  }

  readonly getCredential = (): ApiCredential | null => this.#credential;

  async restore(): Promise<ApiCredential | null> {
    let stored: unknown;
    try {
      stored = (
        await this.#storage.getStorage({ key: weChatSessionStorageKey })
      ).data;
    } catch {
      this.#credential = null;
      return null;
    }
    const session = parseStoredSession(stored);
    if (
      session === null ||
      Date.parse(session.expiresAt) <= this.#clock().getTime()
    ) {
      await this.clear();
      return null;
    }
    this.#credential = {
      accessToken: session.accessToken,
      workspaceId: session.workspaceId,
    };
    return this.#credential;
  }

  async save(session: SessionGrant): Promise<void> {
    const stored: StoredSession = {
      accessToken: session.accessToken,
      workspaceId: session.workspace.id,
      expiresAt: session.expiresAt,
    };
    await this.#storage.setStorage({
      key: weChatSessionStorageKey,
      data: stored,
    });
    this.#credential = {
      accessToken: stored.accessToken,
      workspaceId: stored.workspaceId,
    };
  }

  async clear(): Promise<void> {
    this.#credential = null;
    await this.#storage.removeStorage({ key: weChatSessionStorageKey });
  }

  /** The local credential is cleared whether revocation succeeds or not. */
  async signOut(client: SessionRevoker, everywhere = false): Promise<void> {
    try {
      if (everywhere) await client.signOutEverywhere();
      else await client.signOut();
    } finally {
      await this.clear();
    }
  }
}

function parseStoredSession(value: unknown): StoredSession | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const session = value as Record<string, unknown>;
  if (
    typeof session.accessToken !== "string" ||
    session.accessToken.length === 0 ||
    typeof session.workspaceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      session.workspaceId,
    ) ||
    typeof session.expiresAt !== "string" ||
    Number.isNaN(Date.parse(session.expiresAt))
  ) {
    return null;
  }
  return {
    accessToken: session.accessToken,
    workspaceId: session.workspaceId,
    expiresAt: session.expiresAt,
  };
}

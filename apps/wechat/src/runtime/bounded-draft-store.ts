import type { TaroStorage } from "../auth/session-store";

export const maximumEditorDrafts = 20;
export const editorDraftLifetimeMs = 7 * 24 * 60 * 60_000;

interface DraftTimestamp {
  readonly updatedAt: string;
}

interface StoredDrafts {
  readonly drafts: readonly unknown[];
  readonly version: 1;
}

interface BoundedDraftStoreOptions<Identity, Snapshot extends DraftTimestamp> {
  readonly clock?: (() => Date) | undefined;
  readonly identityKey: (identity: Identity) => string;
  readonly lifetimeMs?: number | undefined;
  readonly limit?: number | undefined;
  readonly parse: (value: unknown) => Snapshot | null;
  readonly storage: TaroStorage;
  readonly storageKey: string;
}

/** Stores a bounded, expiring set of editor drafts partitioned by identity. */
export class BoundedDraftStore<
  Identity,
  Snapshot extends Identity & DraftTimestamp,
> {
  readonly #clock: () => Date;
  readonly #identityKey: (identity: Identity) => string;
  readonly #lifetimeMs: number;
  readonly #limit: number;
  readonly #parse: (value: unknown) => Snapshot | null;
  readonly #storage: TaroStorage;
  readonly #storageKey: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(options: BoundedDraftStoreOptions<Identity, Snapshot>) {
    this.#clock = options.clock ?? (() => new Date());
    this.#identityKey = options.identityKey;
    this.#lifetimeMs = options.lifetimeMs ?? editorDraftLifetimeMs;
    this.#limit = options.limit ?? maximumEditorDrafts;
    this.#parse = options.parse;
    this.#storage = options.storage;
    this.#storageKey = options.storageKey;
  }

  async load(identity: Identity): Promise<Snapshot | null> {
    await this.#pending;
    const key = this.#identityKey(identity);
    return (
      (await this.#read()).find((draft) => this.#identityKey(draft) === key) ??
      null
    );
  }

  save(snapshot: Snapshot): Promise<void> {
    return this.#mutate(async () => {
      const key = this.#identityKey(snapshot);
      const drafts = (await this.#read()).filter(
        (draft) => this.#identityKey(draft) !== key,
      );
      const stored: StoredDrafts = {
        version: 1,
        drafts: [snapshot, ...drafts]
          .sort((first, second) =>
            second.updatedAt.localeCompare(first.updatedAt),
          )
          .slice(0, this.#limit),
      };
      await this.#storage.setStorage({ key: this.#storageKey, data: stored });
    });
  }

  remove(identity: Identity): Promise<void> {
    return this.#mutate(async () => {
      const key = this.#identityKey(identity);
      const drafts = (await this.#read()).filter(
        (draft) => this.#identityKey(draft) !== key,
      );
      if (drafts.length === 0) {
        await this.#storage.removeStorage({ key: this.#storageKey });
        return;
      }
      await this.#storage.setStorage({
        key: this.#storageKey,
        data: { version: 1, drafts } satisfies StoredDrafts,
      });
    });
  }

  #mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.#pending.then(operation, operation);
    this.#pending = next.catch(() => undefined);
    return next;
  }

  async #read(): Promise<Snapshot[]> {
    let value: unknown;
    try {
      value = (await this.#storage.getStorage({ key: this.#storageKey })).data;
    } catch {
      return [];
    }
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [];
    const envelope = value as Record<string, unknown>;
    if (envelope.version !== 1 || !Array.isArray(envelope.drafts)) return [];
    const cutoff = this.#clock().getTime() - this.#lifetimeMs;
    return envelope.drafts
      .map(this.#parse)
      .filter(
        (draft): draft is Snapshot =>
          draft !== null && Date.parse(draft.updatedAt) >= cutoff,
      )
      .slice(0, this.#limit);
  }
}

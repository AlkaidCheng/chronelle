import { useEffect, useRef, useState } from "react";

interface EditorDraftStore<Identity, Snapshot> {
  readonly remove: (identity: Identity) => Promise<void>;
  readonly save: (snapshot: Snapshot) => Promise<void>;
}

interface EditorDraftSnapshot<Fields> {
  readonly baseline: Fields;
  readonly fields: Fields;
}

/** Persists a dirty editor draft after a short idle period and on unmount. */
export function useEditorDraftPersistence<
  Identity,
  Fields,
  Snapshot extends EditorDraftSnapshot<Fields>,
>({
  draft,
  identity,
  same,
  store,
}: {
  readonly draft: Snapshot | null;
  readonly identity: Identity;
  readonly same: (first: Fields, second: Fields) => boolean;
  readonly store: EditorDraftStore<Identity, Snapshot>;
}) {
  const [storageFailed, setStorageFailed] = useState(false);
  const latestDraft = useRef<Snapshot | null>(null);

  useEffect(() => {
    latestDraft.current = draft;
    if (draft === null) return;
    const dirty = !same(draft.fields, draft.baseline);
    const timer = setTimeout(() => {
      void (dirty ? store.save(draft) : store.remove(identity)).catch(() =>
        setStorageFailed(true),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, identity, same, store]);

  useEffect(
    () => () => {
      const current = latestDraft.current;
      if (current !== null && !same(current.fields, current.baseline))
        void store.save(current).catch(() => undefined);
    },
    [same, store],
  );

  return {
    reportStorageFailure: () => setStorageFailed(true),
    storageFailed,
  } as const;
}

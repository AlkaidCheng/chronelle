"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuthSession } from "./auth-session";
import {
  EditorDraftStore,
  eventCreationDraftKeys,
  type RetainedDraftSnapshot,
  isDraftAccessError,
} from "./editor-draft-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queries";

const Context = createContext<EditorDraftStore | null>(null);

export function EditorDraftProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { signal } = useAuthSession();
  const [store] = useState(() => new EditorDraftStore(signal));
  useEffect(() => {
    const clear = () => store.clear();
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!store.hasDrafts) return;
      event.preventDefault();
      event.returnValue = "";
    }
    signal.addEventListener("abort", clear, { once: true });
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      signal.removeEventListener("abort", clear);
      window.removeEventListener("beforeunload", warnBeforeUnload);
      clear();
    };
  }, [signal, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useEditorDraftStore() {
  const store = useContext(Context);
  if (!store) throw new Error("EditorDraftProvider is required.");
  return store;
}

export function useKeptEditorDraft(id: string) {
  const store = useEditorDraftStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(id),
    () => undefined,
  );
}

export function useForgetInaccessibleEventDrafts(
  eventId: string,
  denied: boolean,
) {
  const store = useEditorDraftStore();
  useEffect(() => {
    if (!denied) return;
    store.forget(eventId);
    for (const id of Object.values(eventCreationDraftKeys(eventId)))
      store.forget(id);
  }, [denied, eventId, store]);
}

export function useKeepEditorDraft(
  id: string,
  snapshot: RetainedDraftSnapshot,
  isDirty: boolean,
  onAccessLost: () => void,
  accessId = id,
) {
  const store = useEditorDraftStore();
  const kept = useKeptEditorDraft(id);
  const hasRoom = useSyncExternalStore(
    store.subscribe,
    () => store.canKeep(id),
    () => true,
  );
  const mounted = useRef(false);
  const [isRetained, setIsRetained] = useState(true);
  const { signal } = useAuthSession();
  const queries = useQueryClient();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (isDirty) setIsRetained(hasRoom && store.keep(id, snapshot));
    else {
      store.forget(id);
      setIsRetained(true);
    }
  }, [id, isDirty, snapshot, store, hasRoom]);

  async function save<T>(
    operation: () => Promise<T>,
    onSaved: (saved: T) => void,
  ) {
    if (!store.keep(id, snapshot)) return;
    try {
      const saved = await store.save(id, operation);
      if (mounted.current && !signal.aborted) onSaved(saved);
    } catch (error) {
      if (isDraftAccessError(error) && mounted.current && !signal.aborted) {
        onAccessLost();
        void queries.invalidateQueries({ queryKey: queryKeys.event(accessId) });
        void queries.invalidateQueries({
          queryKey: queryKeys.objectResource(accessId),
        });
      }
    }
  }
  return {
    save,
    discard: () => store.forget(id),
    isRetained,
    failed: kept?.failed ?? false,
  };
}

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
  EventDraftStore,
  type EventDraftSnapshot,
  isDraftAccessError,
} from "./event-draft-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queries";

const Context = createContext<EventDraftStore | null>(null);

export function EventDraftProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { signal } = useAuthSession();
  const [store] = useState(() => new EventDraftStore(signal));
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

export function useEventDraftStore() {
  const store = useContext(Context);
  if (!store) throw new Error("EventDraftProvider is required.");
  return store;
}

export function useKeptEventDraft(id: string) {
  const store = useEventDraftStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(id),
    () => undefined,
  );
}

export function useKeepEventDraft(
  id: string,
  snapshot: EventDraftSnapshot,
  isDirty: boolean,
  onAccessLost: () => void,
  accessId = id,
) {
  const store = useEventDraftStore();
  const kept = useKeptEventDraft(id);
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

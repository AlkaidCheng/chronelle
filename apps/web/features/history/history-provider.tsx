"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { HistoryDrawer } from "./history-drawer";

interface HistoryTarget {
  readonly objectId: string;
  readonly displayName: string;
}
const HistoryContext = createContext<((target: HistoryTarget) => void) | null>(
  null,
);

export function HistoryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [target, setTarget] = useState<HistoryTarget | null>(null);
  return (
    <HistoryContext.Provider value={setTarget}>
      {children}
      {target === null ? null : (
        <HistoryDrawer
          key={target.objectId}
          {...target}
          onClose={() => setTarget(null)}
        />
      )}
    </HistoryContext.Provider>
  );
}

export function useOpenHistory() {
  const open = useContext(HistoryContext);
  if (open === null) throw new Error("HistoryProvider is required.");
  return open;
}

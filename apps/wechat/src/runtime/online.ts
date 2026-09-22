import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
    () => true,
  );
}

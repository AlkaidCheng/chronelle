import { type AnchorHTMLAttributes, useSyncExternalStore } from "react";
import { type EventView, parseEventView } from "../lib/event-views";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function snapshot() {
  return window.location.hash.slice(1) || "/events";
}

export function useLocation() {
  return useSyncExternalStore(subscribe, snapshot);
}

export function usePathname() {
  return useLocation().split("?")[0] ?? "/events";
}

const router = {
  push: (path: string) => {
    window.location.hash = path;
  },
  replace: (path: string) => {
    window.location.replace(`#${path}`);
  },
};

export function useRouter() {
  return router;
}

export function useEventView() {
  const location = useLocation();
  const view = parseEventView(
    new URLSearchParams(location.split("?")[1]).get("view"),
  );
  return [
    view,
    (next: EventView) => router.push(`${location.split("?")[0]}?view=${next}`),
  ] as const;
}

export default function Link({
  href = "/events",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={`#${href}`} />;
}

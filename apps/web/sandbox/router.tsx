import type { AnchorHTMLAttributes } from "react";
import { useAddress } from "./location-store";

export function usePathname() {
  return useAddress()?.pathname ?? "/events";
}

const router = {
  push: (path: string) => {
    window.location.hash = path;
  },
  replace: (path: string) => {
    window.location.replace(`#${path}`);
  },
  // The sandbox has no server render to refresh; its language stays English.
  refresh: () => undefined,
};

export function useRouter() {
  return router;
}

export default function Link({
  href = "/events",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={`#${href}`} />;
}

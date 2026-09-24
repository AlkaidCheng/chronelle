import Taro from "@tarojs/taro";
import { useEffect } from "react";

import { useSession } from "../auth/session-context";
import { getMessages, type MessageKey, resolveLocale } from "../i18n/catalog";

/**
 * Titles the native navigation bar in the account's language, or in the
 * catalog's fallback language until a session is available.
 */
export function useNavigationTitle(key: MessageKey): void {
  const { state } = useSession();
  const locale = resolveLocale(
    state.status === "ready" || state.status === "onboarding"
      ? (state.session.user.locale ?? undefined)
      : undefined,
  );
  const title = getMessages(locale)[key];
  useEffect(() => {
    void Taro.setNavigationBarTitle({ title }).catch(() => undefined);
  }, [title]);
}

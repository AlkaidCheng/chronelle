import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";

import type { useSession } from "../../auth/session-context";
import { EditorStateCard } from "../../components/editor";
import { getMessages, resolveLocale } from "../../i18n/catalog";

type SessionStatus = ReturnType<typeof useSession>["state"]["status"];

export function PeopleSessionState({
  shell,
  status,
}: {
  readonly shell: "editor-shell" | "people-shell";
  readonly status: SessionStatus;
}) {
  const messages = getMessages(resolveLocale(undefined));
  const pending = status === "restoring" || status === "loading";
  const offline = status === "offline";
  const failed = status === "configuration-error" || status === "error";
  return (
    <View className={shell}>
      <EditorStateCard
        action={pending ? undefined : messages.backToEvents}
        detail={
          pending
            ? ""
            : offline
              ? messages.offlineDetail
              : failed
                ? messages.errorDetail
                : ""
        }
        onAction={
          pending
            ? undefined
            : () => void Taro.reLaunch({ url: "/pages/index/index" })
        }
        title={
          pending
            ? messages.restoring
            : offline
              ? messages.offlineTitle
              : failed
                ? messages.errorTitle
                : messages.sessionExpired
        }
      />
    </View>
  );
}

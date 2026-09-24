import { Text, View } from "@tarojs/components";

import type { WorkspaceMark as Mark } from "../account/workspace-identity";
import "../styles/icons.scss";
import "./shell.scss";

export function WorkspaceMark({ mark }: { readonly mark: Mark }) {
  return (
    <View className="workspace-mark" aria-hidden>
      {mark.kind === "home" ? (
        <View className="icon icon--home" />
      ) : (
        <Text>{mark.text}</Text>
      )}
    </View>
  );
}

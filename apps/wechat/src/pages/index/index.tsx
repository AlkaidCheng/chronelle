import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";

import { getMessages, resolveLocale } from "../../i18n/catalog";
import "./index.scss";

function getSystemLanguage(): string | undefined {
  try {
    return Taro.getSystemInfoSync().language;
  } catch {
    return undefined;
  }
}

export default function IndexPage() {
  const locale = resolveLocale(getSystemLanguage());
  const messages = getMessages(locale);

  return (
    <View className="shell">
      <View className="brand-row">
        <Text className="seal">同</Text>
        <View>
          <Text className="brand">Chronelle</Text>
          <Text className="eyebrow">{messages.eyebrow}</Text>
        </View>
      </View>

      <View className="hero">
        <Text className="title">{messages.title}</Text>
        <Text className="description">{messages.description}</Text>
      </View>

      <View className="status-card">
        <View className="status-mark" aria-hidden />
        <View className="status-copy">
          <Text className="status-title">{messages.status}</Text>
          <Text className="status-detail">{messages.detail}</Text>
        </View>
      </View>

      <Text className="footnote">CHRONELLE · 同行</Text>
    </View>
  );
}

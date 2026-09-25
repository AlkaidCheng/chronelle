import { Text, View } from "@tarojs/components";

import "./brand.scss";

/**
 * Where the lockup sits. Beside WeChat's capsule it is drawn at the 118 x 32 px
 * its header art is tuned for, level with the capsule; set inline because Taro
 * rewrites stylesheet px to rpx. On entry pages it scales with the page, and
 * its 36rpx clear space is the page gutter.
 */
const lockupSizes = {
  navigation: { width: "118px", height: "32px" },
  page: { width: "266rpx", height: "72rpx" },
} as const;

export function Brand({
  placement = "page",
}: {
  readonly placement?: keyof typeof lockupSizes;
}) {
  return (
    <View className="brand-lockup" style={lockupSizes[placement]}>
      <Text className="brand-lockup__name">LivTales</Text>
    </View>
  );
}

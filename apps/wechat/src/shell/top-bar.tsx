import { View } from "@tarojs/components";
import type { PropsWithChildren } from "react";

import { useNavigationBarLayout } from "./use-navigation-bar";
import "./shell.scss";

/**
 * The row a page with `navigationStyle: "custom"` draws in place of the
 * native bar: below the status bar, level with WeChat's capsule, which the
 * system keeps drawing at the right.
 */
export function TopBar({ children }: PropsWithChildren) {
  const layout = useNavigationBarLayout();
  return (
    <View
      className="top-bar"
      style={{
        paddingLeft: `${layout.sideInset}px`,
        paddingTop: `${layout.statusBarHeight}px`,
      }}
    >
      <View
        className="top-bar__row"
        style={{ height: `${layout.rowHeight}px` }}
      >
        {children}
      </View>
    </View>
  );
}

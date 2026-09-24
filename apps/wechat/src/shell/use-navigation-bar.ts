import Taro from "@tarojs/taro";
import { useState } from "react";

import {
  type CapsuleRect,
  fallbackNavigationBarLayout,
  type NavigationBarLayout,
  navigationBarLayout,
} from "../runtime/navigation-bar";

function readLayout(): NavigationBarLayout {
  try {
    const window = Taro.getWindowInfo();
    let capsule: CapsuleRect | null = null;
    try {
      capsule = Taro.getMenuButtonBoundingClientRect();
    } catch {
      capsule = null;
    }
    return navigationBarLayout(
      window.statusBarHeight ?? fallbackNavigationBarLayout.statusBarHeight,
      window.windowWidth,
      capsule,
    );
  } catch {
    return fallbackNavigationBarLayout;
  }
}

/** The layout for a page that sets `navigationStyle: "custom"`, read once. */
export function useNavigationBarLayout(): NavigationBarLayout {
  const [layout] = useState(readLayout);
  return layout;
}

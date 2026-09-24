/** The capsule button's box, as `Taro.getMenuButtonBoundingClientRect` reports it. */
export interface CapsuleRect {
  readonly top: number;
  readonly right: number;
  readonly left: number;
  readonly height: number;
}

/** Where a page-drawn navigation row sits beside WeChat's capsule, in px. */
export interface NavigationBarLayout {
  readonly statusBarHeight: number;
  /** A row centred on the capsule, as tall as the native navigation bar. */
  readonly rowHeight: number;
  /** The capsule's distance from the screen edge, mirrored on the left. */
  readonly sideInset: number;
  /** A left drawer's width that stops one inset short of the capsule. */
  readonly drawerWidth: number;
}

export const fallbackNavigationBarLayout: NavigationBarLayout = {
  statusBarHeight: 20,
  rowHeight: 44,
  sideInset: 12,
  drawerWidth: 280,
};

export function navigationBarLayout(
  statusBarHeight: number,
  windowWidth: number,
  capsule: CapsuleRect | null,
): NavigationBarLayout {
  if (
    capsule === null ||
    capsule.height <= 0 ||
    capsule.top < statusBarHeight
  ) {
    return {
      ...fallbackNavigationBarLayout,
      statusBarHeight,
      drawerWidth: Math.min(
        fallbackNavigationBarLayout.drawerWidth,
        windowWidth * 0.84,
      ),
    };
  }
  const sideInset = Math.max(0, windowWidth - capsule.right);
  return {
    statusBarHeight,
    rowHeight: capsule.height + (capsule.top - statusBarHeight) * 2,
    sideInset,
    drawerWidth: Math.min(capsule.left - sideInset, windowWidth * 0.84),
  };
}

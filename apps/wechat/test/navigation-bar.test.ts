import { describe, expect, it } from "vitest";

import { navigationBarLayout } from "../src/runtime/navigation-bar";

describe("Mini Program custom navigation row", () => {
  it("centres the row on the capsule and keeps the drawer clear of it", () => {
    expect(
      navigationBarLayout(44, 375, {
        top: 48,
        right: 368,
        left: 281,
        height: 32,
      }),
    ).toEqual({
      statusBarHeight: 44,
      rowHeight: 40,
      sideInset: 7,
      drawerWidth: 274,
    });
  });

  it("caps the drawer on narrow screens", () => {
    expect(
      navigationBarLayout(20, 320, {
        top: 24,
        right: 313,
        left: 300,
        height: 32,
      }).drawerWidth,
    ).toBeCloseTo(268.8);
  });

  it.each([
    ["missing", null],
    ["unmeasured", { top: 0, right: 0, left: 0, height: 0 }],
  ])(
    "falls back to the native bar's size when the capsule is %s",
    (_, capsule) => {
      expect(navigationBarLayout(20, 375, capsule)).toEqual({
        statusBarHeight: 20,
        rowHeight: 44,
        sideInset: 12,
        drawerWidth: 280,
      });
    },
  );
});

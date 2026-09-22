import { describe, expect, it, vi } from "vitest";

import {
  bindQueryLifecycle,
  type QueryLifecycleSource,
} from "../src/runtime/query-lifecycle";

describe("Mini Program query lifecycle", () => {
  it("forwards focus and connectivity and detaches every listener", async () => {
    let show: () => void = () => undefined;
    let hide: () => void = () => undefined;
    let network: (online: boolean) => void = () => undefined;
    const cleanups = [vi.fn(), vi.fn(), vi.fn()];
    const source: QueryLifecycleSource = {
      getOnline: vi.fn(async () => false),
      onShow: (listener) => {
        show = listener;
        return cleanups[0]!;
      },
      onHide: (listener) => {
        hide = listener;
        return cleanups[1]!;
      },
      onNetworkChange: (listener) => {
        network = listener;
        return cleanups[2]!;
      },
    };
    const target = { setFocused: vi.fn(), setOnline: vi.fn() };

    const unbind = bindQueryLifecycle(source, target);
    await Promise.resolve();
    show();
    hide();
    network(true);

    expect(target.setFocused.mock.calls).toEqual([[true], [false]]);
    expect(target.setOnline.mock.calls).toEqual([[false], [true]]);

    unbind();
    expect(cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("ignores a late network probe after unbinding", async () => {
    let resolveOnline: (online: boolean) => void = () => undefined;
    const source: QueryLifecycleSource = {
      getOnline: () =>
        new Promise((resolve) => {
          resolveOnline = resolve;
        }),
      onShow: () => () => undefined,
      onHide: () => () => undefined,
      onNetworkChange: () => () => undefined,
    };
    const target = { setFocused: vi.fn(), setOnline: vi.fn() };

    bindQueryLifecycle(source, target)();
    resolveOnline(false);
    await Promise.resolve();

    expect(target.setOnline).not.toHaveBeenCalled();
  });
});

import { TransportError } from "@livtales/api-client";
import { describe, expect, it, vi } from "vitest";

import { createTaroJsonTransport } from "../src/api/taro-transport";
import {
  installAbortController,
  MiniProgramAbortController,
  MiniProgramAbortSignal,
} from "../src/runtime/abort-controller";

describe("Mini Program AbortController", () => {
  it("installs only where the runtime lacks AbortController", () => {
    const bare: Record<string, unknown> = {};
    installAbortController(bare);
    expect(bare.AbortController).toBe(MiniProgramAbortController);
    expect(bare.AbortSignal).toBe(MiniProgramAbortSignal);

    const native = { AbortController: globalThis.AbortController };
    installAbortController(native);
    expect(native.AbortController).toBe(globalThis.AbortController);
  });

  it("notifies onabort and each listener once with the abort reason", () => {
    const controller = new MiniProgramAbortController();
    const onabort = vi.fn();
    const listener = vi.fn();
    const handler = { handleEvent: vi.fn() };
    const removed = vi.fn();
    controller.signal.onabort = onabort;
    controller.signal.addEventListener("abort", listener);
    controller.signal.addEventListener("abort", handler);
    controller.signal.addEventListener("abort", removed);
    controller.signal.removeEventListener("abort", removed);

    controller.abort("stopped");
    controller.abort("again");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("stopped");
    expect(onabort).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "abort", target: controller.signal }),
    );
    expect(handler.handleEvent).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    expect(() => controller.signal.throwIfAborted()).toThrow("stopped");
  });

  it("uses an AbortError when no reason is given", () => {
    const controller = new MiniProgramAbortController();
    controller.abort();

    expect(controller.signal.reason).toMatchObject({ name: "AbortError" });
  });

  it("keeps notifying listeners after one of them throws", () => {
    vi.useFakeTimers();
    try {
      const controller = new MiniProgramAbortController();
      const later = vi.fn();
      controller.signal.addEventListener("abort", () => {
        throw new Error("listener failed");
      });
      controller.signal.addEventListener("abort", later);

      controller.abort();

      expect(later).toHaveBeenCalledOnce();
      expect(() => vi.runAllTimers()).toThrow("listener failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an in-flight Mini Program request", async () => {
    const controller = new MiniProgramAbortController();
    const abortTask = vi.fn();
    const transport = createTaroJsonTransport(() => {
      let reject: (reason: unknown) => void = () => undefined;
      const task = new Promise<never>((_resolve, fail) => {
        reject = fail;
      });
      return Object.assign(task, {
        abort: () => {
          abortTask();
          reject({ errMsg: "request:fail abort" });
        },
      });
    });

    const response = transport.request({
      headers: {},
      method: "GET",
      signals: [controller.signal as unknown as AbortSignal],
      timeoutMs: 30_000,
      url: "https://api.example.test/api/events",
    });
    controller.abort();

    await expect(response).rejects.toMatchObject({ kind: "aborted" });
    await expect(response).rejects.toBeInstanceOf(TransportError);
    expect(abortTask).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInstallApp } from "../lib/use-install-app";

/** The browser's deferred prompt, as a page receives it. */
function installPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

function stubDisplayMode(standalone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    })),
  );
}

function stubUserAgent(userAgent: string, touchPoints = 0) {
  vi.stubGlobal("navigator", {
    ...window.navigator,
    userAgent,
    maxTouchPoints: touchPoints,
  });
}

describe("useInstallApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers nothing until the browser raises its prompt", () => {
    stubDisplayMode(false);
    stubUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0");
    const { result } = renderHook(() => useInstallApp());
    expect(result.current.mode).toBe("none");
    expect(result.current.installed).toBe(false);
  });

  it("keeps the browser's prompt and raises it from the app's control", async () => {
    stubDisplayMode(false);
    stubUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    const { result } = renderHook(() => useInstallApp());
    const { event, prompt } = installPromptEvent("accepted");
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.mode).toBe("prompt");
    let accepted = false;
    await act(async () => {
      accepted = await result.current.prompt();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(accepted).toBe(true);
    // Accepted: the prompt is spent, and the control goes.
    expect(result.current.mode).toBe("none");
  });

  it("keeps the prompt for another try after a dismissal", async () => {
    stubDisplayMode(false);
    stubUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0");
    const { result } = renderHook(() => useInstallApp());
    act(() => {
      window.dispatchEvent(installPromptEvent("dismissed").event);
    });
    let accepted = true;
    await act(async () => {
      accepted = await result.current.prompt();
    });
    expect(accepted).toBe(false);
    expect(result.current.mode).toBe("prompt");
  });

  it("hides the control once the app runs installed", () => {
    stubDisplayMode(true);
    stubUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    const { result } = renderHook(() => useInstallApp());
    expect(result.current.installed).toBe(true);
    act(() => {
      window.dispatchEvent(installPromptEvent("accepted").event);
    });
    expect(result.current.mode).toBe("none");
  });

  it("hides the control when the browser reports the install", () => {
    stubDisplayMode(false);
    stubUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    const { result } = renderHook(() => useInstallApp());
    act(() => {
      window.dispatchEvent(installPromptEvent("accepted").event);
    });
    expect(result.current.mode).toBe("prompt");
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.installed).toBe(true);
    expect(result.current.mode).toBe("none");
  });

  it("offers the steps on Safari for iPhone and on an iPad that says Macintosh", () => {
    stubDisplayMode(false);
    stubUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(renderHook(() => useInstallApp()).result.current.mode).toBe("ios");
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15",
      5,
    );
    expect(renderHook(() => useInstallApp()).result.current.mode).toBe("ios");
  });

  it("offers nothing on Safari for the Mac or another browser on iOS", () => {
    stubDisplayMode(false);
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15",
    );
    expect(renderHook(() => useInstallApp()).result.current.mode).toBe("none");
    stubUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/130.0 Mobile/15E148 Safari/604.1",
    );
    expect(renderHook(() => useInstallApp()).result.current.mode).toBe("none");
  });
});

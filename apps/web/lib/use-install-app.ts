"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The browser's deferred install prompt (the `beforeinstallprompt` event),
 * kept so the app can raise it from its own control.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * How the app can be installed from here: through the browser's prompt,
 * raised from the app's control; by the steps Safari on iOS asks for,
 * since it never prompts; or not at all from inside the app (the browser
 * offers no prompt, or the app already runs installed).
 */
export type InstallMode = "prompt" | "ios" | "none";

export interface InstallApp {
  readonly mode: InstallMode;
  /** True while the app runs from a home screen or as its own window. */
  readonly installed: boolean;
  /** Raises the browser's prompt; resolves true when the person accepted. */
  readonly prompt: () => Promise<boolean>;
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (navigator as { standalone?: boolean }).standalone === true;
}

/** Safari on iPhone, iPad, or iPod, where installing is a manual step. */
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const agent = navigator.userAgent;
  const apple =
    /iPhone|iPad|iPod/u.test(agent) ||
    (agent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return apple && !/CriOS|FxiOS|EdgiOS/u.test(agent);
}

/**
 * The install state of this browser and a way to raise its prompt. The
 * prompt event is kept from the moment the browser offers it, so the
 * app's own "Install app" control works whenever the browser would have
 * shown its banner; `appinstalled` and the standalone display mode hide
 * the control once the app is installed.
 */
export function useInstallApp(): InstallApp {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isInstalled());
    setIos(isIosSafari());
    const onPrompt = (raised: Event) => {
      raised.preventDefault();
      setEvent(raised as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const prompt = useCallback(async () => {
    if (event === null) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") setEvent(null);
    return outcome === "accepted";
  }, [event]);

  const mode: InstallMode = installed
    ? "none"
    : event !== null
      ? "prompt"
      : ios
        ? "ios"
        : "none";
  return { mode, installed, prompt };
}

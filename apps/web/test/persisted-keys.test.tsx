// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localeCookie, localeStorageKey } from "../i18n/locales";
import {
  type DisplayPreference,
  displayBootstrap,
  displayChoices,
  displayStorageKey,
} from "../lib/display-preferences";
import {
  EventCollectionProvider,
  useEventCollectionState,
} from "../lib/event-collection-state";
import {
  sessionCookieName,
  sessionPresenceCookieName,
} from "../lib/session-cookie";
import { sandboxStorageKey } from "../sandbox/storage-key";

/**
 * Browsers already hold these names, so they keep the Chronelle spelling
 * (docs/architecture.md, "Names that keep Chronelle"). The literals are
 * written out on purpose: a rename of the constants must fail here.
 */
describe("names browsers already store", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", window.sessionStorage);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps the session and locale cookies and the sandbox key", () => {
    expect(sessionCookieName).toBe("chronelle_session");
    expect(sessionPresenceCookieName).toBe("chronelle_session_present");
    expect(localeCookie).toBe("chronelle.locale");
    expect(localeStorageKey).toBe("chronelle.locale");
    expect(sandboxStorageKey).toBe("chronelle.design-sandbox.v1");
  });

  it("keeps the display keys in React state and in the pre-paint script", () => {
    const names = Object.keys(displayChoices) as DisplayPreference[];
    expect(names.map(displayStorageKey)).toEqual([
      "chronelle.appearance",
      "chronelle.palette",
      "chronelle.density",
      "chronelle.motion",
      "chronelle.sidebar",
    ]);
    expect(displayBootstrap).toContain('getItem("chronelle."+name)');
  });

  it("keeps the Event collection layout key", () => {
    const { result } = renderHook(() => useEventCollectionState(), {
      wrapper: EventCollectionProvider,
    });
    act(() => result.current.changeLayout("list"));
    expect(window.localStorage.getItem("chronelle.event-layout")).toBe("list");
  });
});

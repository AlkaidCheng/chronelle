// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseEventView } from "../lib/event-views";
import { useEventView } from "../lib/use-event-view";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/events");
});

describe("event view navigation", () => {
  it("restores bookmarked views and preserves unrelated URL state", () => {
    window.history.replaceState(
      null,
      "",
      "/events/plan?view=calendar&ref=collection",
    );
    const { result } = renderHook(useEventView);
    expect(result.current[0]).toBe("calendar");
    act(() => result.current[1]("todos"));
    expect(result.current[0]).toBe("todos");
    expect(window.location.search).toBe("?view=todos&ref=collection");
    act(() => result.current[1]("overview"));
    expect(window.location.search).toBe("?ref=collection");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?view=files");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("files");
  });
  it("falls back to overview for unknown input", () => {
    expect(parseEventView("__proto__")).toBe("overview");
    expect(parseEventView(null)).toBe("overview");
  });
});

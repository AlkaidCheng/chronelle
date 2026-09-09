// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseEventView } from "../lib/event-views";
import { useEventPage, useEventView } from "../lib/use-event-view";

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
    act(() => result.current[1]("pages"));
    expect(window.location.search).toBe("?ref=collection");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?view=files");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("files");
  });
  it("opens event pages for an unselected or unknown view", () => {
    expect(parseEventView("__proto__")).toBe("pages");
    expect(parseEventView(null)).toBe("pages");
  });
  it("preserves the selected page across views and history changes", () => {
    window.history.replaceState(
      null,
      "",
      "/events/plan?page=preparation&ref=collection",
    );
    const { result } = renderHook(() => ({
      view: useEventView(),
      page: useEventPage(),
    }));
    expect(result.current.page[0]).toBe("preparation");
    act(() => result.current.view[1]("calendar"));
    expect(result.current.page[0]).toBe("preparation");
    act(() => result.current.page[1]("travel"));
    expect(result.current.view[0]).toBe("calendar");
    expect(new URLSearchParams(window.location.search).get("ref")).toBe(
      "collection",
    );
    act(() => result.current.view[1]("pages"));
    expect(window.location.search).toBe("?page=travel&ref=collection");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?page=preparation");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.page[0]).toBe("preparation");
  });
  it("ignores delayed selections after leaving an event", () => {
    window.history.replaceState(null, "", "/events/first");
    const { result } = renderHook(useEventPage);
    const select = result.current[1];
    window.history.replaceState(null, "", "/events/second");
    act(() => select("previous-event-page"));
    expect(window.location.pathname).toBe("/events/second");
    expect(window.location.search).toBe("");
  });
  it("does not add a history entry for an unchanged selection", () => {
    window.history.replaceState(null, "", "/events/plan?page=preparation");
    const { result } = renderHook(useEventPage);
    const length = window.history.length;
    act(() => result.current[1]("preparation"));
    expect(window.history.length).toBe(length);
  });
});

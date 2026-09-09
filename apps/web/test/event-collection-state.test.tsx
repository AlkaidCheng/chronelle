// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { useAuthSession } from "../lib/auth-session";
import {
  EventCollectionProvider,
  useEventCollectionReturn,
  useEventCollectionState,
} from "../lib/event-collection-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function Collection({
  ready = true,
  removed = false,
}: {
  ready?: boolean;
  removed?: boolean;
}) {
  const { container, remember } = useEventCollectionReturn(ready);
  return (
    <main ref={container} tabIndex={-1}>
      {!removed && (
        <a
          data-event-id="event"
          href="/events/event"
          onClick={(event) => {
            remember("event", event);
            event.preventDefault();
          }}
        >
          Open event
        </a>
      )}
    </main>
  );
}

describe("collection return state", () => {
  it("clears criteria and return references at every session boundary", () => {
    const { result } = renderHook(
      () => ({
        auth: useAuthSession(),
        collection: useEventCollectionState(),
      }),
      { wrapper: Providers },
    );
    for (const transition of [
      () =>
        result.current.auth.startSession({
          accessToken: "session",
          workspaceId: "personal",
        }),
      () => result.current.auth.switchWorkspace("shared"),
      () => result.current.auth.switchWorkspace("personal"),
      () => result.current.auth.signOut(),
    ]) {
      act(() =>
        result.current.collection.change({
          query: "Private plans",
          sort: "name",
          filter: "past",
        }),
      );
      result.current.collection.returnPoint.current = {
        id: "private",
        top: 80,
        scrollY: 600,
      };
      act(transition);
      expect(result.current.collection.criteria).toEqual({
        query: "",
        sort: "date",
        filter: "all",
      });
      expect(result.current.collection.returnPoint.current).toBeNull();
    }
  });

  it("keeps criteria usable without browser storage and resets on reload", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("Storage denied");
    });
    const first = renderHook(useEventCollectionState, {
      wrapper: EventCollectionProvider,
    });
    act(() => first.result.current.change({ query: "Private plans" }));
    expect(first.result.current.criteria.query).toBe("Private plans");
    first.unmount();
    const reloaded = renderHook(useEventCollectionState, {
      wrapper: EventCollectionProvider,
    });
    expect(reloaded.result.current.criteria.query).toBe("");
  });

  it.each([false, true])(
    "restores once after data settles, including removed card: %s",
    async (removed) => {
      const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      vi.spyOn(window, "scrollY", "get").mockReturnValue(600);
      const wrap = (child: ReactNode) => (
        <StrictMode>
          <EventCollectionProvider>{child}</EventCollectionProvider>
        </StrictMode>
      );
      const view = render(wrap(<Collection />));
      fireEvent.click(screen.getByRole("link"));
      view.rerender(wrap(null));
      view.rerender(wrap(<Collection ready={false} removed={removed} />));
      expect(scroll).not.toHaveBeenCalled();
      view.rerender(wrap(<Collection removed={removed} />));
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(scroll).toHaveBeenCalledWith({ top: 600, behavior: "instant" });
      expect(
        removed ? screen.getByRole("main") : screen.getByRole("link"),
      ).toHaveFocus();
      view.rerender(wrap(<Collection removed={removed} />));
      expect(scroll).toHaveBeenCalledTimes(1);
    },
  );

  it("does not move focus after the user interacts while waiting", async () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const wrap = (child: ReactNode) => (
      <EventCollectionProvider>{child}</EventCollectionProvider>
    );
    const view = render(wrap(<Collection />));
    fireEvent.click(screen.getByRole("link"));
    view.rerender(wrap(null));
    view.rerender(wrap(<Collection ready={false} />));
    fireEvent.keyDown(window, { key: "Tab" });
    view.rerender(wrap(<Collection />));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does not save a return point for a link opened in another tab", async () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const wrap = (child: ReactNode) => (
      <EventCollectionProvider>{child}</EventCollectionProvider>
    );
    const view = render(wrap(<Collection />));
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    view.rerender(wrap(null));
    view.rerender(wrap(<Collection />));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroll).not.toHaveBeenCalled();
  });
});

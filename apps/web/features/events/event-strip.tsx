"use client";

import type { EventPage } from "@chronelle/schemas";
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IconButton } from "../../components/icon-button";
import { PlusIcon } from "../../components/icons";
import type { EventView } from "../../lib/event-views";
import { canInsertComponent } from "../../lib/keyboard";
import { useComponentShortcut } from "../../lib/use-component-shortcut";
import type { PageDrop } from "./use-event-pages";

/**
 * One strip under the event title: the event's pages in a sideways scroller,
 * the active page's options, a thin plus to add a page, then the data views.
 * Page buttons navigate; the data views are tabs with arrow-key movement.
 */
export function EventStrip({
  pages,
  selectedPageId,
  showingPages,
  onSelectPage,
  canAddPage,
  onAddPage,
  addPageRef,
  pageMenu,
  pageDrop,
  onInsertComponent,
  views,
  activeView,
  onSelectView,
  tabRef,
}: {
  readonly pages: readonly EventPage[];
  readonly selectedPageId: string | undefined;
  readonly showingPages: boolean;
  readonly onSelectPage: (pageId: string) => void;
  readonly canAddPage: boolean;
  readonly onAddPage: () => void;
  readonly addPageRef?: Ref<HTMLButtonElement>;
  readonly pageMenu?: ReactNode;
  readonly pageDrop?: RefObject<PageDrop | null> | undefined;
  /** The component shortcut pressed on a page button opens the picker. */
  readonly onInsertComponent?: (() => void) | undefined;
  readonly views: readonly { readonly id: EventView; readonly label: string }[];
  readonly activeView: EventView;
  readonly onSelectView: (view: EventView) => void;
  readonly tabRef: (view: EventView, element: HTMLButtonElement | null) => void;
}) {
  const navigation = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<EventView, HTMLButtonElement>());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const shortcut = useComponentShortcut();

  function dropProps(pageId: string) {
    const allowed = () => pageDrop?.current?.allowed(pageId) ?? false;
    return {
      "data-drop-target": dropTarget === pageId || undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!allowed()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(pageId);
      },
      onDragLeave: () => setDropTarget(null),
      onDrop: (event: DragEvent<HTMLElement>) => {
        setDropTarget(null);
        if (!allowed()) return;
        event.preventDefault();
        pageDrop?.current?.drop(pageId);
      },
    };
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: The current page changes which button must be in view.
  useLayoutEffect(() => {
    const strip = navigation.current;
    if (!strip) return;
    const reveal = () => {
      const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current) return;
      const bounds = strip.getBoundingClientRect();
      const item = current.getBoundingClientRect();
      if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        strip.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [pages, selectedPageId]);

  function onTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    view: EventView,
  ) {
    const index = views.findIndex((tab) => tab.id === view);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + views.length) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = views[next];
    if (target === undefined) return;
    onSelectView(target.id);
    tabs.current.get(target.id)?.focus();
  }

  return (
    <div className="event-strip">
      {pages.length > 0 || canAddPage ? (
        <nav
          aria-label="Pages"
          className="event-strip-pages"
          onKeyDown={(event) => {
            if (
              !onInsertComponent ||
              !canInsertComponent(
                event.nativeEvent,
                event.currentTarget,
                shortcut.value,
              )
            )
              return;
            event.preventDefault();
            onInsertComponent();
          }}
        >
          <div ref={navigation} className="event-strip-scroller">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                data-page-id={page.id}
                title={page.name}
                aria-current={
                  showingPages && page.id === selectedPageId
                    ? "page"
                    : undefined
                }
                onClick={() => onSelectPage(page.id)}
                {...dropProps(page.id)}
              >
                {page.name}
              </button>
            ))}
          </div>
          {showingPages && selectedPageId !== undefined ? pageMenu : null}
          {canAddPage ? (
            <IconButton
              ref={addPageRef}
              label="Add page"
              className="event-strip-plus"
              onClick={onAddPage}
            >
              <PlusIcon />
            </IconButton>
          ) : null}
        </nav>
      ) : null}
      {pages.length > 0 || canAddPage ? (
        <span className="event-strip-gap" aria-hidden="true" />
      ) : null}
      <div aria-label="Event views" className="tab-list" role="tablist">
        {views.map((tab) => (
          <button
            aria-controls={`event-panel-${tab.id}`}
            aria-selected={activeView === tab.id}
            className={activeView === tab.id ? "active" : ""}
            id={`event-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onSelectView(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, tab.id)}
            ref={(element) => {
              if (element === null) tabs.current.delete(tab.id);
              else tabs.current.set(tab.id, element);
              tabRef(tab.id, element);
            }}
            role="tab"
            tabIndex={activeView === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

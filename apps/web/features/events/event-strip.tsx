"use client";

import type { EventPage } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
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
import { MenuItem, QuietMenu } from "../../components/quiet-menu";
import type { EventView } from "../../lib/event-views";
import { canInsertComponent } from "../../lib/keyboard";
import { useComponentShortcut } from "../../lib/use-component-shortcut";
import { useLongPress } from "../../lib/use-long-press";
import type { PageDrop } from "./use-event-pages";

/**
 * One strip under the event title: the event's pages, a thin plus that
 * adds one, a bar, then the views the account keeps on the event, and a
 * plus that opens the gallery. The strip never wraps: the tabs that do not
 * fit fold into one chip at the end that lists them; the current tab never
 * folds. Page buttons navigate; the views are tabs with arrow-key movement.
 * On a touch screen, holding a tab or the chip opens Manage tabs.
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
  onAddView,
  onManageTabs,
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
  /** Opens the gallery; absent when the account cannot arrange the strip. */
  readonly onAddView?: (() => void) | undefined;
  /** Opens Manage tabs, from a touch held on a tab or the fold chip. */
  readonly onManageTabs?: (() => void) | undefined;
}) {
  const t = useTranslations("event");
  const strip = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<EventView, HTMLButtonElement>());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const shortcut = useComponentShortcut();
  const currentKey = showingPages
    ? selectedPageId === undefined
      ? null
      : `page:${selectedPageId}`
    : `view:${activeView}`;
  // The held tab or chip takes focus first, so the dialog returns to it.
  const longPress = useLongPress(
    (target) =>
      target.closest<HTMLButtonElement>(
        '[data-tab-key], [data-strip-chip] [aria-haspopup="menu"]',
      ),
    (element) => {
      element.focus();
      onManageTabs?.();
    },
  );

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

  // What does not fit folds from the end, views before pages, with every
  // tab shown for the measure so a change of width can unfold again. The
  // chip takes its room as soon as one tab folds, and the measure runs
  // again once the chip shows its count, so its width is counted too.
  const tabKeys = [
    ...pages.map((page) => `page:${page.id}`),
    ...views.map((view) => `view:${view.id}`),
  ];
  const labels = [
    ...pages.map((page) => page.name),
    ...views.map((view) => view.label),
  ];
  // biome-ignore lint/correctness/useExhaustiveDependencies: The tabs, their names, the current one, and the chip decide the fold; the strip's width is watched.
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const measure = () => {
      const buttons = Array.from(
        element.querySelectorAll<HTMLElement>("[data-tab-key]"),
      );
      const chip = element.querySelector<HTMLElement>("[data-strip-chip]");
      for (const button of buttons) button.hidden = false;
      if (chip) chip.hidden = true;
      // The strip's own parts, not an open menu hanging off one of them.
      const fits = () => {
        const parts = Array.from(element.children);
        const width = parts.reduce(
          (total, part) => total + part.getBoundingClientRect().width,
          gap * (parts.length - 1),
        );
        return width <= element.clientWidth + 1;
      };
      const next = new Set<string>();
      for (const button of buttons.reverse()) {
        if (fits()) break;
        const key = button.dataset.tabKey ?? "";
        if (key === currentKey) continue;
        button.hidden = true;
        if (chip) chip.hidden = false;
        next.add(key);
      }
      setFolded((current) =>
        current.size === next.size && [...next].every((key) => current.has(key))
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [
    tabKeys.join("\n"),
    labels.join("\n"),
    currentKey,
    canAddPage,
    folded.size,
  ]);

  function onTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    view: EventView,
  ) {
    const shown = views.filter((tab) => !folded.has(`view:${tab.id}`));
    const index = shown.findIndex((tab) => tab.id === view);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % shown.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + shown.length) % shown.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = shown.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = shown[next];
    if (target === undefined) return;
    onSelectView(target.id);
    tabs.current.get(target.id)?.focus();
  }

  const foldedPages = pages.filter((page) => folded.has(`page:${page.id}`));
  const foldedViews = views.filter((view) => folded.has(`view:${view.id}`));
  const foldedCount = foldedPages.length + foldedViews.length;

  return (
    <div
      className="event-strip"
      ref={strip}
      {...(onManageTabs ? longPress : {})}
    >
      {pages.length > 0 || canAddPage ? (
        <nav
          aria-label={t("pagesLabel")}
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
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className="event-tab"
              data-page-id={page.id}
              data-tab-key={`page:${page.id}`}
              hidden={folded.has(`page:${page.id}`)}
              title={page.name}
              aria-current={
                showingPages && page.id === selectedPageId ? "page" : undefined
              }
              onClick={() => onSelectPage(page.id)}
              {...dropProps(page.id)}
            >
              {page.name}
            </button>
          ))}
          {showingPages && selectedPageId !== undefined ? pageMenu : null}
          {canAddPage ? (
            <IconButton
              ref={addPageRef}
              label={t("addPage")}
              className="event-strip-plus"
              onClick={onAddPage}
            >
              <PlusIcon />
            </IconButton>
          ) : null}
        </nav>
      ) : null}
      {pages.length > 0 || canAddPage ? (
        <span className="event-strip-bar" aria-hidden="true" />
      ) : null}
      <div aria-label={t("viewsLabel")} className="tab-list" role="tablist">
        {views.map((tab) => (
          <button
            aria-controls={`event-panel-${tab.id}`}
            aria-selected={activeView === tab.id}
            className={`event-tab${activeView === tab.id ? " active" : ""}`}
            data-tab-key={`view:${tab.id}`}
            hidden={folded.has(`view:${tab.id}`)}
            id={`event-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onSelectView(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, tab.id)}
            ref={(element) => {
              if (element === null) tabs.current.delete(tab.id);
              else tabs.current.set(tab.id, element);
            }}
            role="tab"
            tabIndex={activeView === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <span className="event-strip-end">
        <span data-strip-chip hidden={foldedCount === 0}>
          <QuietMenu
            label={t("moreTabs", { count: foldedCount })}
            icon={
              <span className="event-strip-fold">
                {t("moreChip", { count: foldedCount })}
              </span>
            }
            className="event-strip-more"
          >
            {foldedPages.map((page) => (
              <MenuItem key={page.id} onSelect={() => onSelectPage(page.id)}>
                {page.name}
              </MenuItem>
            ))}
            {foldedViews.map((view) => (
              <MenuItem key={view.id} onSelect={() => onSelectView(view.id)}>
                {view.label}
              </MenuItem>
            ))}
          </QuietMenu>
        </span>
        {onAddView ? (
          <IconButton
            label={t("addView")}
            className="event-strip-plus"
            onClick={onAddView}
          >
            <PlusIcon />
          </IconButton>
        ) : null}
      </span>
    </div>
  );
}

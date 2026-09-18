"use client";

import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ContextCommand } from "../../components/context-commands";
import { MoreIcon } from "../../components/icons";
import { MenuItem, QuietMenu } from "../../components/quiet-menu";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import {
  useEventLayout,
  useIsLayoutSaving,
  useLayoutUndo,
  useRestoreEventLayout,
} from "../../lib/event-layout-queries";
import { undoDirection } from "../../lib/keyboard";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useEventPage } from "../../lib/use-event-view";
import type { EventPagesAdding } from "./event-pages";
import { LayoutRecoveryDialog } from "./layout-recovery";

export interface PageDrop {
  readonly allowed: (pageId: string) => boolean;
  readonly drop: (pageId: string) => void;
}

/** Undo and redo of layout changes, as the arrange bar offers them. */
export interface LayoutUndoControls {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

/**
 * What the event page owns around its pages: the layout, the selected page,
 * the add dialogs, arranging, and the active page's options menu. The strip
 * and the canvas both read from it.
 */
export function useEventPagesState(eventId: string, canEdit: boolean) {
  const t = useTranslations("event");
  const layout = useEventLayout(eventId);
  useForgetInaccessibleEventDrafts(
    eventId,
    layout.isError && !isTemporaryReadError(layout.error),
  );
  const undo = useLayoutUndo(eventId);
  const saving = useIsLayoutSaving(eventId);
  const [selectedPageId, selectPage] = useEventPage();
  const [adding, setAdding] = useState<EventPagesAdding | null>(null);
  const [arranging, setArranging] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The page menu is rebuilt when the dialog changes the pages, so focus
  // goes to whichever menu control exists once the dialog has closed.
  const returnToMenu = useRef(false);
  useEffect(() => {
    if (optionsOpen || !returnToMenu.current) return;
    returnToMenu.current = false;
    document
      .querySelector<HTMLElement>('.event-strip-menu [aria-haspopup="menu"]')
      ?.focus();
  }, [optionsOpen]);
  useEffect(() => {
    if (canEdit) return;
    setAdding(null);
    setArranging(false);
  }, [canEdit]);
  // While arranging, the keys move the layout stack, not the content one:
  // the handler runs first and marks the event consumed.
  const restore = useRestoreEventLayout(eventId);
  const layoutVersion = layout.data?.version;
  const undoState = undo.data;
  const rewind = restore.mutate;
  const rewinding = restore.isPending || saving;
  const canMoveLayout = (direction: "undo" | "redo") =>
    canEdit &&
    !rewinding &&
    layoutVersion !== undefined &&
    undoState.version === layoutVersion &&
    undoState[direction].length > 0;
  const moveLayout = useCallback(
    (direction: "undo" | "redo") => {
      const targetVersion = undoState[direction].at(-1);
      if (
        !canEdit ||
        rewinding ||
        layoutVersion === undefined ||
        undoState.version !== layoutVersion ||
        targetVersion === undefined
      )
        return;
      rewind({
        expectedVersion: layoutVersion,
        targetVersion,
        intent: direction,
      });
    },
    [canEdit, layoutVersion, undoState, rewinding, rewind],
  );
  useEffect(() => {
    if (!arranging || !canEdit || layoutVersion === undefined) return;
    function onKeyDown(event: KeyboardEvent) {
      const direction = undoDirection(event);
      if (direction === null) return;
      event.preventDefault();
      moveLayout(direction);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [arranging, canEdit, layoutVersion, moveLayout]);
  /** The arrange bar's undo and redo of layout changes. */
  const layoutUndo: LayoutUndoControls = {
    canUndo: canMoveLayout("undo"),
    canRedo: canMoveLayout("redo"),
    onUndo: () => moveLayout("undo"),
    onRedo: () => moveLayout("redo"),
  };
  const addPageButton = useRef<HTMLButtonElement>(null);
  /** The canvas registers how a dragged component lands on a page button. */
  const pageDrop = useRef<PageDrop | null>(null);
  const pages = layout.data?.pages ?? [];
  const selectedPage =
    pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const canAddPage = canEdit && layout.data !== undefined && pages.length < 20;
  const canArrange = canEdit && pages.length > 0;
  const total = pages.reduce(
    (count, page) => count + page.components.length,
    0,
  );
  const canAddComponent =
    canEdit &&
    selectedPage !== undefined &&
    selectedPage.components.length < 20 &&
    total < 100;
  const commands: ContextCommand[] =
    canAddPage && !saving
      ? [
          {
            id: "add-page",
            label: t("addPage"),
            description: t("addPageDescription"),
            target: addPageButton,
          },
        ]
      : [];
  const pageMenu: ReactNode =
    layout.data !== undefined && selectedPage !== undefined ? (
      <QuietMenu
        label={t("optionsFor", { name: selectedPage.name })}
        icon={<MoreIcon />}
        align="start"
        className="event-strip-menu"
      >
        {canArrange ? (
          <MenuItem onSelect={() => setArranging(!arranging)}>
            {arranging ? t("doneArranging") : t("arrange")}
          </MenuItem>
        ) : null}
        <MenuItem onSelect={() => setOptionsOpen(true)}>
          {canEdit ? t("pageOptions") : t("layoutHistory")}
        </MenuItem>
      </QuietMenu>
    ) : null;
  const dialog: ReactNode =
    optionsOpen && layout.data !== undefined ? (
      <LayoutRecoveryDialog
        layout={layout.data}
        canEdit={canEdit}
        undo={undo.data}
        onClose={() => {
          returnToMenu.current = true;
          setOptionsOpen(false);
        }}
      />
    ) : null;
  return {
    layout,
    pages,
    selectedPage,
    selectedPageId,
    selectPage,
    adding,
    setAdding,
    arranging,
    setArranging,
    canArrange,
    layoutUndo,
    canAddPage,
    canAddComponent,
    addPageButton,
    pageDrop,
    commands,
    pageMenu,
    dialog,
  };
}

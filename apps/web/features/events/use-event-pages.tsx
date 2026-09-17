"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ContextCommand } from "../../components/context-commands";
import { MoreIcon } from "../../components/icons";
import { MenuItem, QuietMenu } from "../../components/quiet-menu";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import {
  useEventLayout,
  useIsLayoutSaving,
  useLayoutUndo,
} from "../../lib/event-layout-queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useEventPage } from "../../lib/use-event-view";
import type { EventPagesAdding } from "./event-pages";
import { LayoutRecoveryDialog } from "./layout-recovery";

export interface PageDrop {
  readonly allowed: (pageId: string) => boolean;
  readonly drop: (pageId: string) => void;
}

/**
 * What the event page owns around its pages: the layout, the selected page,
 * the add dialogs, arranging, and the active page's options menu. The strip
 * and the canvas both read from it.
 */
export function useEventPagesState(eventId: string, canEdit: boolean) {
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
            label: "Add page",
            description: "Create a named page in this event",
            target: addPageButton,
          },
        ]
      : [];
  const pageMenu: ReactNode =
    layout.data !== undefined && selectedPage !== undefined ? (
      <QuietMenu
        label={`Options for ${selectedPage.name}`}
        icon={<MoreIcon />}
        align="start"
        className="event-strip-menu"
      >
        {canArrange ? (
          <MenuItem onSelect={() => setArranging(!arranging)}>
            {arranging ? "Done arranging" : "Arrange layout"}
          </MenuItem>
        ) : null}
        <MenuItem onSelect={() => setOptionsOpen(true)}>
          {canEdit ? "Page options" : "Layout history"}
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
    canAddPage,
    canAddComponent,
    addPageButton,
    pageDrop,
    commands,
    pageMenu,
    dialog,
  };
}

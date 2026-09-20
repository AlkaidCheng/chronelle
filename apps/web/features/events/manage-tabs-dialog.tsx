"use client";

import type { EventLayoutResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import { EditorDialogHeader } from "../../components/editor-dialog-controls";
import { ErrorNotice } from "../../components/feedback";
import { EyeIcon, EyeOffIcon, GripIcon } from "../../components/icons";
import { ViewMark } from "../../components/view-marks";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { fixedViews } from "../../lib/event-tabs";
import { type EventView, eventViewLabel } from "../../lib/event-views";
import { moveKey, placeKey } from "../../lib/key-order";
import { useDialogHelp } from "../../lib/use-dialog-help";
import { useSessionDialog } from "../../lib/use-session-dialog";
import type { EventTabsState } from "./use-event-tabs";

interface Row {
  readonly key: string;
  readonly name: string;
  readonly mark: ReactNode;
  readonly hidden: boolean;
  /** Absent when the row cannot be taken off the event. */
  readonly onRemove?: (() => void) | undefined;
}

/**
 * Manage tabs: one list per side of the strip's bar, each capped in
 * height and scrolling. A row drags to reorder (its grip moves it with the
 * arrow keys too); the eye hides the tab but keeps it listed; the cross
 * takes a view off the event. Pages reorder through the event's layout,
 * which every account shares; the views through the account's own tabs.
 */
export function ManageTabsDialog({
  eventId,
  layout,
  canEdit,
  tabs,
  onClose,
  onNewPage,
  onAddView,
}: {
  readonly eventId: string;
  /** The event's pages; absent while the layout has not loaded. */
  readonly layout: EventLayoutResponse | undefined;
  readonly canEdit: boolean;
  readonly tabs: EventTabsState;
  readonly onClose: () => void;
  readonly onNewPage: () => void;
  readonly onAddView: () => void;
}) {
  const t = useTranslations("manageTabs");
  const dialog = useSessionDialog(onClose);
  const help = useDialogHelp("tabs");
  const save = useUpdateEventLayout(eventId);
  const pages = layout?.pages ?? [];
  const pageOrder = pages.map((page) => page.id);

  function reorderPages(order: readonly string[]) {
    if (layout === undefined || save.isPending) return;
    const next = order
      .map((id) => pages.find((page) => page.id === id))
      .filter((page) => page !== undefined);
    save.mutate({ expectedVersion: layout.version, pages: next });
  }

  const pageRows: Row[] = pages.map((page) => ({
    key: page.id,
    name: page.name,
    mark: <ViewMark view="pages" />,
    hidden: tabs.arranged.hidden.has(page.id),
  }));
  const viewRows: Row[] = tabs.arranged.order.map((view) => ({
    key: view,
    name: eventViewLabel(view),
    mark: <ViewMark view={view} />,
    hidden: tabs.arranged.hidden.has(view),
    onRemove: fixedViews.has(view) ? undefined : () => tabs.remove(view),
  }));

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog manage-tabs-dialog"
      aria-labelledby="manage-tabs-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <EditorDialogHeader
        headingId="manage-tabs-heading"
        title={t("title")}
        closeLabel={t("close")}
        onClose={onClose}
        help={help}
      />
      <div className="event-create-body">
        <TabList
          heading={t("pages")}
          action={canEdit ? { label: t("newPage"), onSelect: onNewPage } : null}
          rows={pageRows}
          empty={t("noPages")}
          canReorder={canEdit && !save.isPending}
          onMove={(key, delta) => reorderPages(moveKey(pageOrder, key, delta))}
          onPlace={(key, before) =>
            reorderPages(placeKey(pageOrder, key, before))
          }
          onToggleHidden={tabs.toggleHidden}
        />
        {save.isError ? <ErrorNotice error={save.error} /> : null}
        <TabList
          heading={t("views")}
          action={{ label: t("addView"), onSelect: onAddView }}
          rows={viewRows}
          canReorder
          onMove={(key, delta) => tabs.moveView(key as EventView, delta)}
          onPlace={(key, before) =>
            tabs.placeView(key as EventView, before as EventView | null)
          }
          onToggleHidden={tabs.toggleHidden}
        />
      </div>
      <footer className="event-create-footer">
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          {t("done")}
        </button>
      </footer>
    </dialog>
  );
}

function TabList({
  heading,
  action,
  rows,
  empty,
  canReorder,
  onMove,
  onPlace,
  onToggleHidden,
}: {
  readonly heading: string;
  readonly action: {
    readonly label: string;
    readonly onSelect: () => void;
  } | null;
  readonly rows: readonly Row[];
  readonly empty?: string | undefined;
  readonly canReorder: boolean;
  readonly onMove: (key: string, delta: number) => void;
  readonly onPlace: (key: string, before: string | null) => void;
  readonly onToggleHidden: (key: string) => void;
}) {
  const t = useTranslations("manageTabs");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>();
  const keys = rows.map((row) => row.key);

  function onGripKeyDown(event: ReactKeyboardEvent<HTMLElement>, key: string) {
    const delta =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    onMove(key, delta);
  }
  function onDragOver(event: DragEvent<HTMLElement>, key: string) {
    if (dragging === null || dragging === key) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < bounds.top + bounds.height / 2;
    setDropBefore(before ? key : (keys[keys.indexOf(key) + 1] ?? null));
  }
  function onDrop() {
    if (dragging !== null && dropBefore !== undefined)
      onPlace(dragging, dropBefore);
    setDragging(null);
    setDropBefore(undefined);
  }

  return (
    <section className="manage-tabs-section">
      <h3 className="manage-tabs-heading">
        <span>{heading}</span>
        {action ? (
          <button
            type="button"
            className="manage-tabs-action"
            onClick={action.onSelect}
          >
            {action.label}
          </button>
        ) : null}
      </h3>
      {rows.length === 0 && empty !== undefined ? (
        <p className="manage-tabs-empty">{empty}</p>
      ) : (
        <ul className="manage-tabs-list" aria-label={heading}>
          {rows.map((row) => (
            <li
              key={row.key}
              className="manage-tabs-row"
              data-hidden={row.hidden || undefined}
              data-dragging={dragging === row.key || undefined}
              data-drop={
                dragging !== null && dropBefore === row.key
                  ? "before"
                  : dragging !== null &&
                      dropBefore === null &&
                      row.key === keys.at(-1)
                    ? "after"
                    : undefined
              }
              draggable={canReorder || undefined}
              onDragStart={(event) => {
                if (!canReorder) return;
                event.dataTransfer.effectAllowed = "move";
                setDragging(row.key);
              }}
              onDragOver={(event) => onDragOver(event, row.key)}
              onDrop={(event) => {
                event.preventDefault();
                onDrop();
              }}
              onDragEnd={onDrop}
            >
              {canReorder ? (
                <button
                  type="button"
                  className="manage-tabs-grip"
                  aria-label={t("move", { name: row.name })}
                  onKeyDown={(event) => onGripKeyDown(event, row.key)}
                >
                  <GripIcon />
                </button>
              ) : (
                <span className="manage-tabs-grip" aria-hidden="true" />
              )}
              <span className="manage-tabs-mark">{row.mark}</span>
              <span className="manage-tabs-name">
                {row.name}
                {row.hidden ? (
                  <span className="manage-tabs-state">{t("hidden")}</span>
                ) : null}
              </span>
              <button
                type="button"
                className="manage-tabs-control"
                aria-label={
                  row.hidden
                    ? t("show", { name: row.name })
                    : t("hide", { name: row.name })
                }
                aria-pressed={row.hidden}
                onClick={() => onToggleHidden(row.key)}
              >
                {row.hidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              {row.onRemove ? (
                <button
                  type="button"
                  className="manage-tabs-control manage-tabs-remove"
                  aria-label={t("remove", { name: row.name })}
                  onClick={row.onRemove}
                >
                  &#215;
                </button>
              ) : (
                <span className="manage-tabs-control" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

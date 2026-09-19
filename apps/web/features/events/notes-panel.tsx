"use client";

import type { NoteListItem, NoteListQuery } from "@chronelle/schemas";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import { EmptyState } from "../../components/feedback";
import { HeadMenu } from "../../components/head-menu";
import { SortIcon } from "../../components/icons";
import { LinkedText } from "../../components/linked-text";
import { AddRow } from "../../components/quick-add-row";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import { noteSheet } from "../../lib/export/sheets";
import { formatMoment } from "../../lib/format";
import { notePreview } from "../../lib/note-fields";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { PanelHeading } from "./component-frame";
import { ExportControl } from "./export-control";
import { ShareControl } from "./share-control";
import { NoteForm } from "./note-form";
import { NoteInspector } from "./note-inspector";

const noteSorts: readonly NoteListQuery["sort"][] = ["edited", "title"];

/**
 * The Event's notes as cards: the title, the first two lines of the text,
 * and who edited it last. A card opens in place to show the whole text with
 * its links; the row menu offers Edit, History, and Move to Trash; Add note
 * opens the editor.
 */
export function NotesPanel({
  canEdit,
  eventId,
  notes,
  onChangeSort,
  sort,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly notes: readonly NoteListItem[];
  readonly onChangeSort: (sort: NoteListQuery["sort"]) => void;
  readonly sort: NoteListQuery["sort"];
}) {
  const t = useTranslations("notes");
  const views = useTranslations("views");
  const controls = useTranslations("controls");
  const exports = useTranslations("export");
  const locale = useLocale();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const panel = useRef<HTMLElement>(null);
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();
  const closeAdding = useCallback(() => {
    setIsAdding(false);
    panel.current
      ?.querySelector<HTMLButtonElement>(".quick-add")
      ?.focus({ preventScroll: true });
  }, []);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const menu = (note: NoteListItem) => {
    const history: RowMenuEntry = {
      kind: "action",
      label: t("menu.history"),
      onSelect: () =>
        openHistory({ objectId: note.id, displayName: note.displayName }),
    };
    const entries: RowMenuEntry[] = canEdit
      ? [
          {
            kind: "action",
            label: t("menu.edit"),
            onSelect: () => setEditingId(note.id),
          },
          history,
          { kind: "rule" },
          {
            kind: "action",
            label: t("menu.moveToTrash"),
            danger: true,
            onSelect: () => openLifecycle({ ...note, eventId }),
          },
        ]
      : [history];
    return (
      <RowMenu
        entries={entries}
        label={t("actionsFor", { name: note.displayName })}
      />
    );
  };

  return (
    <section className="planning-panel panel-column" ref={panel}>
      <PanelHeading
        controls={
          <div className="head-controls">
            <HeadMenu
              active={sort !== "edited"}
              entries={noteSorts.map((choice) => ({
                kind: "radio",
                label: t(`sorts.${choice}`),
                checked: choice === sort,
                onSelect: () => {
                  if (choice !== sort) onChangeSort(choice);
                },
              }))}
              icon={<SortIcon />}
              label={controls("sort")}
              name={sort === "edited" ? undefined : t(`sorts.${sort}`)}
            />
            <ExportControl
              eventId={eventId}
              panel={panel}
              sheet={() => noteSheet(notes)}
              view="notes"
              viewName={views("notes")}
            />
            <ShareControl
              eventId={eventId}
              view="notes"
              viewName={views("notes")}
            />
          </div>
        }
        caption={exports("sortOnly", { sort: t(`sorts.${sort}`) })}
        count={
          notes.length === 0 ? undefined : t("count", { count: notes.length })
        }
        title={views("notes")}
      />
      {notes.length === 0 && !canEdit ? (
        <EmptyState title={t("empty")} />
      ) : null}
      {notes.length === 0 ? null : (
        <div className="note-list">
          {notes.map((note) => {
            const isOpen = open.has(note.id);
            const when = formatMoment(note.updatedAt, locale);
            return (
              <article
                className="note-card"
                data-open={isOpen || undefined}
                id={`note-${note.id}`}
                key={note.id}
              >
                <h3 className="note-title">
                  <button
                    aria-expanded={isOpen}
                    className="note-toggle"
                    onClick={() => toggle(note.id)}
                    type="button"
                  >
                    {note.displayName}
                  </button>
                </h3>
                {isOpen ? (
                  <LinkedText className="note-body" text={note.body} />
                ) : note.body.trim() === "" ? null : (
                  <p className="note-preview">{notePreview(note.body)}</p>
                )}
                <div className="note-by">
                  <span>
                    {note.editedBy === null
                      ? t("edited", { when })
                      : t("editedBy", { when, name: note.editedBy })}
                  </span>
                  {menu(note)}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {canEdit ? (
        <div className="quick-add-item quick-add-notes">
          <AddRow
            aria-haspopup="dialog"
            label={t("add")}
            onOpen={() => setIsAdding(true)}
          />
        </div>
      ) : null}
      {canEdit && isAdding ? (
        <NoteForm key={eventId} eventId={eventId} onCancel={closeAdding} />
      ) : null}
      {!canEdit || editingId === null ? null : (
        <NoteInspector
          key={editingId}
          eventId={eventId}
          noteId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </section>
  );
}

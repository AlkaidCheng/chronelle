"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  eventComponentKindSchema,
  type EventComponentKind,
  type EventLayoutResponse,
  type EventPage,
} from "@chronelle/schemas";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import {
  useEventLayout,
  useUpdateEventLayout,
} from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { eventComponents } from "../../lib/event-components";
import { EventComponent } from "./event-component";

function AddPageContentDialog({
  layout,
  pageId,
  onClose,
  onSaved,
}: {
  readonly layout: EventLayoutResponse;
  readonly pageId: string | null;
  readonly onClose: () => void;
  readonly onSaved: (pageId: string) => void;
}) {
  const [source] = useState(layout);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<EventComponentKind>("todos");
  const save = useUpdateEventLayout(layout.eventId);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || (pageId === null && !name.trim())) return;
    const id = pageId ?? crypto.randomUUID();
    const pages: EventPage[] =
      pageId === null
        ? [...source.pages, { id, name: name.trim(), components: [] }]
        : source.pages.map((page) =>
            page.id === id
              ? {
                  ...page,
                  components: [
                    ...page.components,
                    { id: crypto.randomUUID(), kind },
                  ],
                }
              : page,
          );
    save.mutate(
      { expectedVersion: source.version, pages },
      {
        onSuccess: () => {
          onSaved(id);
          onClose();
        },
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-labelledby="page-content-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!save.isPending) onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id="page-content-heading">
          {pageId === null ? "Add a page" : "Add a component"}
        </h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close page dialog"
          disabled={save.isPending}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <form onSubmit={submit} aria-busy={save.isPending}>
        <div className="event-create-body">
          {pageId === null ? (
            <label className="field">
              Page name
              <input
                ref={nameInput}
                required
                maxLength={80}
                placeholder="Preparation, travel, or anything you need"
                value={name}
                disabled={save.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : (
            <fieldset className="component-picker" disabled={save.isPending}>
              <legend>Choose a component</legend>
              {eventComponentKindSchema.options.map((option, index) => (
                <label key={option} className="component-choice">
                  <input
                    ref={index === 0 ? nameInput : undefined}
                    type="radio"
                    name="component-kind"
                    value={option}
                    checked={kind === option}
                    onChange={() => setKind(option)}
                  />
                  <span>
                    <strong>{eventComponents[option].label}</strong>
                    <span>{eventComponents[option].description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {save.isError ? <ErrorNotice error={save.error} /> : null}
        </div>
        <footer className="event-create-footer">
          <button
            type="button"
            className="button button-quiet"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={save.isPending || (pageId === null && !name.trim())}
          >
            {save.isPending
              ? "Saving..."
              : pageId === null
                ? "Add page"
                : `Add ${eventComponents[kind].label}`}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function EventPages({
  eventId,
  canEdit,
}: {
  readonly eventId: string;
  readonly canEdit: boolean;
}) {
  const layout = useEventLayout(eventId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ pageId: string | null } | null>(null);
  if (layout.isError)
    return (
      <ErrorNotice
        error={layout.error}
        onRefresh={() => void layout.refetch()}
      />
    );
  if (layout.isPending) return <LoadingState label="Loading event pages" />;
  const selected =
    layout.data.pages.find((page) => page.id === selectedId) ??
    layout.data.pages[0];
  const totalComponents = layout.data.pages.reduce(
    (count, page) => count + page.components.length,
    0,
  );
  return (
    <section className="event-pages" aria-label="Event pages">
      <div className="event-pages-toolbar">
        <nav aria-label="Pages" className="event-pages-navigation">
          {layout.data.pages.map((page) => (
            <button
              type="button"
              key={page.id}
              aria-current={page.id === selected?.id ? "page" : undefined}
              onClick={() => setSelectedId(page.id)}
            >
              {page.name}
            </button>
          ))}
        </nav>
        {canEdit && layout.data.pages.length < 20 ? (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setAdding({ pageId: null })}
          >
            Add page
          </button>
        ) : null}
      </div>
      {selected ? (
        <>
          <div className="panel-heading">
            <h2>{selected.name}</h2>
            {canEdit &&
            selected.components.length < 20 &&
            totalComponents < 100 ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAdding({ pageId: selected.id })}
              >
                Add component
              </button>
            ) : null}
          </div>
          {selected.components.length === 0 ? (
            <EmptyState
              title="Make room for your plans"
              description={
                canEdit
                  ? "Add a component when you need it. This page starts with just what you choose."
                  : "This page has no components yet."
              }
            />
          ) : null}
          <div className="event-page-components">
            {selected.components.map((component) => (
              <EventComponent
                key={component.id}
                kind={component.kind}
                eventId={eventId}
                canEdit={canEdit}
              />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title="A place for your event"
          description={
            canEdit
              ? "Add your first page to organize preparations, travel, or the day itself."
              : "The planner has not added any pages yet."
          }
        />
      )}
      {adding && canEdit ? (
        <AddPageContentDialog
          layout={layout.data}
          pageId={adding.pageId}
          onSaved={setSelectedId}
          onClose={() => {
            setAdding(null);
            void layout.refetch();
          }}
        />
      ) : null}
    </section>
  );
}

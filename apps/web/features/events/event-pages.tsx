"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  EventComponentKind,
  EventLayoutResponse,
  EventPage,
} from "@chronelle/schemas";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import {
  useEventLayout,
  useUpdateEventLayout,
} from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useEventPage } from "../../lib/use-event-view";
import {
  eventComponents,
  findEventComponents,
} from "../../lib/event-components";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import { EventPageCanvas } from "./event-page-canvas";
import { LayoutRecoveryTools } from "./layout-recovery";
import { AddEventPageDialog } from "./add-event-page-dialog";

function AddComponentDialog({
  layout,
  pageId,
  onClose,
  onSaved,
}: {
  readonly layout: EventLayoutResponse;
  readonly pageId: string;
  readonly onClose: () => void;
  readonly onSaved: (pageId: string, message: string) => void;
}) {
  const [source] = useState(layout);
  const [kind, setKind] = useState<EventComponentKind>("todos");
  const [search, setSearch] = useState("");
  const options = findEventComponents(search);
  const selectedKind = options.includes(kind) ? kind : options[0];
  const target = source.pages.find((page) => page.id === pageId);
  const alreadyHere = target?.components.some(
    (component) => component.kind === selectedKind,
  );
  const usedElsewhere = source.pages.some(
    (page) =>
      page.id !== pageId &&
      page.components.some((component) => component.kind === selectedKind),
  );
  const save = useUpdateEventLayout(layout.eventId);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || !selectedKind) return;
    const pages: EventPage[] = source.pages.map((page) =>
      page.id === pageId
        ? {
            ...page,
            components: [
              ...page.components,
              { id: crypto.randomUUID(), kind: selectedKind ?? kind },
            ],
          }
        : page,
    );
    save.mutate(
      { expectedVersion: source.version, pages },
      {
        onSuccess: () => {
          onSaved(
            pageId,
            `${eventComponents[selectedKind].label} added to ${target?.name}.`,
          );
          onClose();
        },
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog component-catalog-dialog"
      aria-labelledby="page-content-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!save.isPending) onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id="page-content-heading">Add a component</h2>
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
          <p className="catalog-destination" id="component-destination">
            Add to {target?.name}.
          </p>
          <label className="field">
            Find a component
            <input
              ref={nameInput}
              type="search"
              placeholder="Try /calendar or expenses"
              aria-describedby="component-destination"
              maxLength={120}
              value={search}
              disabled={save.isPending}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                ) {
                  if (event.key === "Enter") event.preventDefault();
                  return;
                }
                if (
                  event.key === "ArrowDown" &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  !event.repeat &&
                  selectedKind
                ) {
                  event.preventDefault();
                  dialog.current
                    ?.querySelector<HTMLInputElement>(
                      'input[name="component-kind"]:checked',
                    )
                    ?.focus();
                }
              }}
            />
          </label>
          <p className="catalog-context" role="status">
            {selectedKind && (alreadyHere || usedElsewhere)
              ? `${eventComponents[selectedKind].label} is already used ${alreadyHere ? "on this page" : "on another page"}. You can add another view of the same records.`
              : "Add a view of this event's records, without creating or copying them."}
          </p>
          <fieldset className="component-picker" disabled={save.isPending}>
            <legend>Choose a component</legend>
            {options.map((option) => (
              <label key={option} className="component-choice">
                <input
                  type="radio"
                  name="component-kind"
                  value={option}
                  aria-labelledby={`component-${option}-label`}
                  aria-describedby={`component-${option}-description`}
                  checked={selectedKind === option}
                  onChange={() => setKind(option)}
                />
                <span>
                  <strong id={`component-${option}-label`}>
                    {eventComponents[option].label}
                  </strong>
                  <span id={`component-${option}-description`}>
                    {eventComponents[option].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {options.length === 0 ? (
            <p role="status">
              No matching components. Try calendar, to-dos, or files.{" "}
              <button
                type="button"
                className="button button-quiet"
                disabled={save.isPending}
                onClick={() => {
                  setSearch("");
                  nameInput.current?.focus();
                }}
              >
                Clear search
              </button>
            </p>
          ) : null}
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
            disabled={save.isPending || !selectedKind}
          >
            {save.isPending
              ? "Saving..."
              : selectedKind
                ? `Add ${eventComponents[selectedKind].label}`
                : "Add component"}
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
  useForgetInaccessibleEventDrafts(
    eventId,
    !canEdit || (layout.isError && !isTemporaryReadError(layout.error)),
  );
  const [selectedId, setSelectedId] = useEventPage();
  const [adding, setAdding] = useState<{ pageId: string | null } | null>(null);
  const [notice, setNotice] = useState<{
    pageId: string;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (!canEdit) {
      setAdding(null);
      setNotice(null);
    }
  }, [canEdit]);
  const refreshNotice = layout.isError ? (
    <ErrorNotice
      error={layout.error}
      onRefresh={() => void layout.refetch()}
      isRefreshing={layout.isFetching}
      refreshLabel="Refresh latest"
    />
  ) : null;
  if (layout.isPending) return <LoadingState label="Loading event pages" />;
  if (
    layout.data === undefined ||
    (layout.isError && !isTemporaryReadError(layout.error))
  )
    return refreshNotice;
  const selected =
    layout.data.pages.find((page) => page.id === selectedId) ??
    layout.data.pages[0];
  const insertion = {
    layout: layout.data,
    onSaved: (pageId: string, message: string) => {
      setSelectedId(pageId);
      setNotice({ pageId, message });
    },
    onClose: () => {
      setAdding(null);
      void layout.refetch();
    },
  };
  return (
    <>
      {refreshNotice}
      <p role="status" className="page-location-notice">
        {notice?.pageId === selected?.id ? notice?.message : ""}
      </p>
      {selectedId && selectedId !== selected?.id ? (
        <p role="status" className="page-location-notice">
          The requested page is unavailable.
          {selected ? ` Showing ${selected.name}.` : ""}
        </p>
      ) : null}
      <EventPageCanvas
        layout={layout.data}
        selected={selected}
        canEdit={canEdit}
        onSelect={setSelectedId}
        onAddPage={() => setAdding({ pageId: null })}
        onAddComponent={() => {
          if (selected) setAdding({ pageId: selected.id });
        }}
        onRefresh={() => layout.refetch()}
        renderTools={(busy) => (
          <LayoutRecoveryTools
            layout={layout.data}
            canEdit={canEdit}
            disabled={busy}
          />
        )}
      />
      {adding && canEdit ? (
        adding.pageId === null ? (
          <AddEventPageDialog {...insertion} />
        ) : (
          <AddComponentDialog {...insertion} pageId={adding.pageId} />
        )
      ) : null}
    </>
  );
}

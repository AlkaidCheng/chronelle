"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { EventLayoutResponse } from "@chronelle/schemas";
import { ErrorNotice } from "../../components/feedback";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

export function AddEventPageDialog({
  layout,
  onClose,
  onSaved,
}: {
  readonly layout: EventLayoutResponse;
  readonly onClose: () => void;
  readonly onSaved: (pageId: string, message: string) => void;
}) {
  const [source] = useState(layout);
  const [name, setName] = useState("");
  const save = useUpdateEventLayout(layout.eventId);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || !name.trim()) return;
    const id = crypto.randomUUID();
    save.mutate(
      {
        expectedVersion: source.version,
        pages: [...source.pages, { id, name: name.trim(), components: [] }],
      },
      {
        onSuccess: () => {
          onSaved(id, `${name.trim()} page added.`);
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
        <h2 id="page-content-heading">Add a page</h2>
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
          <p className="field-hint" id="page-name-hint">
            Pages organize this event. Start with a name, then add components
            such as To-dos or Calendar.
          </p>
          <label className="field">
            Page name
            <input
              ref={nameInput}
              required
              maxLength={80}
              placeholder="Preparation, travel, or anything you need"
              aria-describedby="page-name-hint"
              value={name}
              disabled={save.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
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
            disabled={save.isPending || !name.trim()}
          >
            {save.isPending ? "Saving..." : "Add page"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

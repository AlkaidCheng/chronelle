"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { eventPagesSchema, type EventLayoutResponse } from "@chronelle/schemas";
import { ErrorNotice } from "../../components/feedback";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import {
  createPresetPage,
  eventPagePresets,
} from "../../lib/event-page-presets";
import { eventComponents } from "../../lib/event-components";

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
  const [name, setName] = useState<string | null>(null);
  const [selection, setSelection] = useState(() => ({
    preset: eventPagePresets[0] as (typeof eventPagePresets)[number],
    page: createPresetPage(eventPagePresets[0]),
  }));
  const page = {
    ...selection.page,
    name: (name ?? selection.page.name).trim(),
  };
  const candidate = eventPagesSchema.safeParse([...source.pages, page]);
  const save = useUpdateEventLayout(layout.eventId);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || !candidate.success) return;
    save.mutate(
      {
        expectedVersion: source.version,
        pages: candidate.data,
      },
      {
        onSuccess: () => {
          onSaved(page.id, `${page.name} page added.`);
          onClose();
        },
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog page-preset-dialog"
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
      <form
        onSubmit={submit}
        aria-busy={save.isPending}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <div className="event-create-body">
          <p className="field-hint" id="page-name-hint">
            Pages organize this event. Start blank or choose a few useful views.
          </p>
          <label className="field">
            Page name
            <input
              ref={nameInput}
              required
              maxLength={80}
              placeholder="Preparation, travel, or anything you need"
              aria-describedby="page-name-hint"
              value={name ?? selection.page.name}
              disabled={save.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset className="page-preset-picker" disabled={save.isPending}>
            <legend>Start with</legend>
            {eventPagePresets.map((preset) => (
              <label key={preset.id} className="page-preset-choice">
                <input
                  type="radio"
                  name="page-preset"
                  checked={selection.preset.id === preset.id}
                  onChange={() =>
                    setSelection({ preset, page: createPresetPage(preset) })
                  }
                />
                <span>{preset.label}</span>
              </label>
            ))}
          </fieldset>
          <section className="page-preset-preview" aria-label="Page preview">
            <h3>{page.name || "New page"}</h3>
            <p role="status">{selection.preset.description}</p>
            {page.components.length > 0 ? (
              <ol>
                {page.components.map((component) => (
                  <li key={component.id}>
                    {eventComponents[component.kind].label}
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="field-hint">
              Adds one page of event-wide views. Existing pages and records stay
              unchanged.
            </p>
          </section>
          {page.name && !candidate.success ? (
            <p role="status">
              This page exceeds a layout limit. Choose Blank or remove an unused
              page or component first.
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
            disabled={save.isPending || !candidate.success}
          >
            {save.isPending ? "Saving..." : "Add page"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

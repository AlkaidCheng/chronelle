"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { eventPagesSchema, type EventLayoutResponse } from "@livtales/schemas";
import { CountedField } from "../../components/counted-field";
import { EditorDialogHeader } from "../../components/editor-dialog-controls";
import { ErrorNotice } from "../../components/feedback";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { useDialogHelp } from "../../lib/use-dialog-help";
import { useSessionDialog } from "../../lib/use-session-dialog";
import {
  createPresetPage,
  eventPagePresets,
  presetDescription,
  presetLabel,
} from "../../lib/event-page-presets";
import { componentKindLabel } from "../../lib/event-components";

export function AddEventPageDialog({
  layout,
  onClose,
  onSaved,
}: {
  readonly layout: EventLayoutResponse;
  readonly onClose: () => void;
  readonly onSaved: (pageId: string, message: string) => void;
}) {
  const t = useTranslations("pageDialog");
  const common = useTranslations("common");
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
  const help = useDialogHelp("page");
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
          onSaved(page.id, t("added", { name: page.name }));
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
      <EditorDialogHeader
        headingId="page-content-heading"
        title={t("title")}
        closeLabel={t("close")}
        isPending={save.isPending}
        onClose={onClose}
        help={help}
      />
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
          <CountedField
            disabled={save.isPending}
            inputRef={nameInput}
            label={t("name")}
            limit={80}
            onChange={setName}
            placeholder={t("namePlaceholder")}
            required
            value={name ?? selection.page.name}
          />
          <fieldset className="page-preset-picker" disabled={save.isPending}>
            <legend>{t("startWith")}</legend>
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
                <span>{presetLabel(preset.id)}</span>
              </label>
            ))}
          </fieldset>
          <section className="page-preset-preview" aria-label={t("preview")}>
            <h3>{page.name || t("newPage")}</h3>
            <p role="status">{presetDescription(selection.preset.id)}</p>
            {page.components.length > 0 ? (
              <ol>
                {page.components.map((component) => (
                  <li key={component.id}>
                    {componentKindLabel(component.kind)}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
          {page.name && !candidate.success ? (
            <p role="status">{t("limit")}</p>
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
            {common("cancel")}
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={save.isPending || !candidate.success}
          >
            {save.isPending ? t("saving") : t("add")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

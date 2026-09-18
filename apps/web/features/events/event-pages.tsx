"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  EventComponentKind,
  EventLayoutResponse,
  EventPage,
} from "@chronelle/schemas";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import {
  componentKindDescription,
  componentKindLabel,
  findEventComponents,
} from "../../lib/event-components";
import { isTemporaryReadError } from "../../lib/query-errors";
import { EventPageCanvas } from "./event-page-canvas";
import { AddEventPageDialog } from "./add-event-page-dialog";
import type { PageDrop } from "./use-event-pages";
import { newId } from "../../lib/new-id";

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
  const t = useTranslations("componentDialog");
  const common = useTranslations("common");
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
              { id: newId(), kind: selectedKind ?? kind },
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
            t("added", {
              component: componentKindLabel(selectedKind),
              page: target?.name ?? "",
            }),
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
        <h2 id="page-content-heading">{t("title")}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("close")}
          disabled={save.isPending}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <form onSubmit={submit} aria-busy={save.isPending}>
        <div className="event-create-body">
          <p className="catalog-destination" id="component-destination">
            {t("addTo", { page: target?.name ?? "" })}
          </p>
          <label className="field">
            {t("find")}
            <input
              ref={nameInput}
              type="search"
              placeholder={t("placeholder")}
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
              ? t(alreadyHere ? "usedHere" : "usedElsewhere", {
                  component: componentKindLabel(selectedKind),
                })
              : t("intro")}
          </p>
          <fieldset className="component-picker" disabled={save.isPending}>
            <legend>{t("choose")}</legend>
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
                    {componentKindLabel(option)}
                  </strong>
                  <span id={`component-${option}-description`}>
                    {componentKindDescription(option)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {options.length === 0 ? (
            <p role="status">
              {t("noMatch")}{" "}
              <button
                type="button"
                className="button button-quiet"
                disabled={save.isPending}
                onClick={() => {
                  setSearch("");
                  nameInput.current?.focus();
                }}
              >
                {t("clearSearch")}
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
            {common("cancel")}
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={save.isPending || !selectedKind}
          >
            {save.isPending
              ? t("saving")
              : selectedKind
                ? t("addNamed", { component: componentKindLabel(selectedKind) })
                : t("add")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export interface EventPagesAdding {
  readonly pageId: string | null;
}

export function EventPages({
  layout,
  selected,
  selectedId,
  canEdit,
  onSelect,
  adding,
  onAddingChange,
  arranging,
  onArrangingChange,
  pageDrop,
}: {
  readonly layout: UseQueryResult<EventLayoutResponse>;
  readonly selected: EventPage | undefined;
  readonly selectedId: string | null;
  readonly canEdit: boolean;
  readonly onSelect: (pageId: string) => void;
  readonly adding: EventPagesAdding | null;
  readonly onAddingChange: (adding: EventPagesAdding | null) => void;
  readonly arranging: boolean;
  readonly onArrangingChange: (arranging: boolean) => void;
  readonly pageDrop?: RefObject<PageDrop | null> | undefined;
}) {
  const t = useTranslations("componentDialog");
  const [notice, setNotice] = useState<{
    pageId: string;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (!canEdit) setNotice(null);
  }, [canEdit]);
  const refreshNotice = layout.isError ? (
    <ErrorNotice
      error={layout.error}
      onRefresh={() => void layout.refetch()}
      isRefreshing={layout.isFetching}
      refreshLabel={t("refreshLatest")}
    />
  ) : null;
  if (layout.isPending) return <LoadingState label={t("loadingPages")} />;
  if (
    layout.data === undefined ||
    (layout.isError && !isTemporaryReadError(layout.error))
  )
    return refreshNotice;
  const insertion = {
    layout: layout.data,
    onSaved: (pageId: string, message: string) => {
      onSelect(pageId);
      setNotice({ pageId, message });
    },
    onClose: () => {
      onAddingChange(null);
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
          {t("pageUnavailable")}
          {selected ? ` ${t("showing", { name: selected.name })}` : ""}
        </p>
      ) : null}
      <EventPageCanvas
        layout={layout.data}
        selected={selected}
        canEdit={canEdit}
        onSelect={onSelect}
        onAddPage={() => onAddingChange({ pageId: null })}
        onAddComponent={() => {
          if (selected) onAddingChange({ pageId: selected.id });
        }}
        onRefresh={() => layout.refetch()}
        arranging={arranging}
        onArrangingChange={onArrangingChange}
        pageDrop={pageDrop}
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

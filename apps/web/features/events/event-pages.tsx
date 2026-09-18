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
import type { EventLayoutResponse, EventPage } from "@chronelle/schemas";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { CheckIcon } from "../../components/icons";
import { ViewMark } from "../../components/view-marks";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import {
  type AddableEventComponentKind,
  componentKindDescription,
  componentKindLabel,
  findEventComponents,
} from "../../lib/event-components";
import { isTemporaryReadError } from "../../lib/query-errors";
import { EventPageCanvas } from "./event-page-canvas";
import { AddEventPageDialog } from "./add-event-page-dialog";
import type { LayoutUndoControls, PageDrop } from "./use-event-pages";
import { newId } from "../../lib/new-id";

/**
 * Add a component to a page: the gallery's cards, one per kind the page
 * may hold, narrowed by the search. A card adds its component at once and
 * the dialog closes; a kind the page or another page already holds says
 * so on its card, since another view of the same records is fine. Enter
 * in the search adds the first card shown.
 */
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
  const [search, setSearch] = useState("");
  const options = findEventComponents(search);
  const target = source.pages.find((page) => page.id === pageId);
  const usedOn = (kind: AddableEventComponentKind) =>
    target?.components.some((component) => component.kind === kind)
      ? "onThisPage"
      : source.pages.some(
            (page) =>
              page.id !== pageId &&
              page.components.some((component) => component.kind === kind),
          )
        ? "onAnotherPage"
        : null;
  const t = useTranslations("componentDialog");
  const common = useTranslations("common");
  const save = useUpdateEventLayout(layout.eventId);
  const dialog = useSessionDialog(onClose);
  const nameInput = useRef<HTMLInputElement>(null);
  const firstCard = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function add(kind: AddableEventComponentKind) {
    if (save.isPending) return;
    const pages: EventPage[] = source.pages.map((page) =>
      page.id === pageId
        ? {
            ...page,
            components: [...page.components, { id: newId(), kind }],
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
              component: componentKindLabel(kind),
              page: target?.name ?? "",
            }),
          );
          onClose();
        },
      },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const first = options[0];
    if (first !== undefined) add(first);
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog gallery-dialog component-catalog-dialog"
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
                  !event.repeat
                ) {
                  event.preventDefault();
                  firstCard.current?.focus();
                }
              }}
            />
          </label>
          <div className="gallery-scroll">
            <div className="gallery-grid">
              {options.map((option, index) => {
                const used = usedOn(option);
                return (
                  <button
                    key={option}
                    ref={index === 0 ? firstCard : undefined}
                    type="button"
                    className="gallery-card"
                    aria-label={t("addNamed", {
                      component: componentKindLabel(option),
                    })}
                    aria-describedby={`component-${option}-description`}
                    data-used={used ?? undefined}
                    disabled={save.isPending}
                    onClick={() => add(option)}
                  >
                    <span className="gallery-glyph">
                      <ViewMark view={option} />
                    </span>
                    <strong>{componentKindLabel(option)}</strong>
                    <span
                      className="gallery-line"
                      id={`component-${option}-description`}
                    >
                      {componentKindDescription(option)}
                    </span>
                    {used === null ? null : (
                      <span className="gallery-mark">
                        <CheckIcon />
                        {t(used)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
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
  layoutUndo,
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
  readonly layoutUndo?: LayoutUndoControls | undefined;
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
        layoutUndo={layoutUndo}
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

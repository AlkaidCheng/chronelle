"use client";

import { useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { EventLayoutResponse, EventPage } from "@chronelle/schemas";
import { EmptyState, ErrorNotice } from "../../components/feedback";
import { eventComponents } from "../../lib/event-components";
import { moveEventComponent, moveEventPage } from "../../lib/event-layout";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { EventComponent } from "./event-component";

export function EventPageCanvas({
  layout,
  selected,
  canEdit,
  onSelect,
  onAddPage,
  onAddComponent,
  onRefresh,
}: {
  readonly layout: EventLayoutResponse;
  readonly selected: EventPage | undefined;
  readonly canEdit: boolean;
  readonly onSelect: (pageId: string) => void;
  readonly onAddPage: () => void;
  readonly onAddComponent: () => void;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const save = useUpdateEventLayout(layout.eventId);
  const locked = useRef(false);
  const drag = useRef<{
    componentId: string;
    source: EventLayoutResponse;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const navigation = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState<{
    trigger: HTMLElement | null;
    origin: HTMLElement | null;
    version: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (
      save.isPending ||
      !focusRequest ||
      layout.version < focusRequest.version
    )
      return;
    const trigger = focusRequest?.trigger;
    if (!trigger?.isConnected) return;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== trigger &&
      document.activeElement !== focusRequest.origin
    )
      return;
    const target = trigger.matches(":disabled")
      ? (trigger
          .closest(".component-toolbar")
          ?.querySelector<HTMLButtonElement>(".component-drag-handle") ??
        navigation.current?.querySelector<HTMLButtonElement>("[aria-current]"))
      : trigger;
    target?.focus();
  }, [focusRequest, save.isPending, layout.version]);
  const total = layout.pages.reduce(
    (count, page) => count + page.components.length,
    0,
  );
  const canAdd =
    canEdit && selected && selected.components.length < 20 && total < 100;
  const selectedIndex = layout.pages.findIndex(
    (page) => page.id === selected?.id,
  );

  function persist(
    source: EventLayoutResponse,
    pages: EventPage[],
    message: string,
    targetPageId?: string,
  ) {
    if (!canEdit || locked.current || pages === source.pages) return;
    locked.current = true;
    let trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const origin = trigger;
    let version = source.version;
    setAnnouncement("");
    save.mutate(
      { expectedVersion: source.version, pages },
      {
        onSuccess: (saved) => {
          version = saved.version;
          setAnnouncement(message);
          if (targetPageId) {
            onSelect(targetPageId);
            trigger =
              navigation.current?.querySelector<HTMLButtonElement>(
                `[data-page-id="${targetPageId}"]`,
              ) ?? null;
          }
        },
        onSettled: () => {
          locked.current = false;
          setFocusRequest({ trigger, origin, version });
        },
      },
    );
  }

  function move(
    componentId: string,
    targetPageId: string,
    beforeId: string | null,
    source = layout,
  ) {
    const target = source.pages.find((page) => page.id === targetPageId);
    persist(
      source,
      moveEventComponent(source.pages, componentId, targetPageId, beforeId),
      `Component moved in ${target?.name ?? "page"}.`,
      targetPageId !== selected?.id ? targetPageId : undefined,
    );
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
    setDropTarget(null);
  }

  function dropProps(page: EventPage, beforeId: string | null) {
    const key = beforeId ?? page.id;
    const allowed = () => {
      const current = drag.current;
      return (
        canEdit &&
        !locked.current &&
        current !== null &&
        (page.components.length < 20 ||
          page.components.some((item) => item.id === current.componentId))
      );
    };
    return {
      "data-drop-target": dropTarget === key || undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!allowed()) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(key);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDropTarget(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const current = drag.current;
        if (!allowed() || !current) return;
        event.preventDefault();
        event.stopPropagation();
        move(current.componentId, page.id, beforeId, current.source);
        endDrag();
      },
    };
  }

  return (
    <section
      className="event-pages"
      aria-label="Event pages"
      onKeyDown={(event) => {
        if (
          event.key !== "/" ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.repeat ||
          !canAdd ||
          save.isPending
        )
          return;
        if (
          !(event.target instanceof HTMLElement) ||
          event.target.closest(
            "input, textarea, select, [contenteditable], dialog",
          )
        )
          return;
        event.preventDefault();
        onAddComponent();
      }}
    >
      <div className="event-pages-toolbar">
        <nav
          ref={navigation}
          aria-label="Pages"
          className="event-pages-navigation"
        >
          {layout.pages.map((page) => (
            <button
              key={page.id}
              type="button"
              data-page-id={page.id}
              aria-current={page.id === selected?.id ? "page" : undefined}
              onClick={() => onSelect(page.id)}
              {...dropProps(page, null)}
            >
              {page.name}
            </button>
          ))}
        </nav>
        {canEdit && layout.pages.length < 20 ? (
          <button
            type="button"
            className="button button-secondary"
            disabled={save.isPending}
            onClick={onAddPage}
          >
            Add page
          </button>
        ) : null}
      </div>
      <p className="visually-hidden" role="status">
        {save.isPending ? "Saving layout..." : announcement}
      </p>
      {save.isError ? (
        <ErrorNotice
          error={save.error}
          onRefresh={() => {
            void onRefresh().then(() => save.reset());
          }}
        />
      ) : null}
      {selected ? (
        <>
          <div className="panel-heading">
            <h2>{selected.name}</h2>
            <div className="composition-actions">
              {canEdit && layout.pages.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={save.isPending || selectedIndex === 0}
                    onClick={() =>
                      persist(
                        layout,
                        moveEventPage(
                          layout.pages,
                          selected.id,
                          layout.pages[selectedIndex - 1]?.id ?? null,
                        ),
                        "Page moved earlier.",
                      )
                    }
                  >
                    Move page earlier
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={
                      save.isPending ||
                      selectedIndex === layout.pages.length - 1
                    }
                    onClick={() =>
                      persist(
                        layout,
                        moveEventPage(
                          layout.pages,
                          selected.id,
                          layout.pages[selectedIndex + 2]?.id ?? null,
                        ),
                        "Page moved later.",
                      )
                    }
                  >
                    Move page later
                  </button>
                </>
              ) : null}
              {canAdd ? (
                <button
                  type="button"
                  className="button button-secondary"
                  aria-keyshortcuts="/"
                  disabled={save.isPending}
                  onClick={onAddComponent}
                >
                  Add component
                </button>
              ) : null}
            </div>
          </div>
          {canEdit ? (
            <p className="composition-hint">
              Use / to find a component. Drag its handle to reorder or drop it
              on a page. Move controls work with touch and keyboard.
            </p>
          ) : null}
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
            {selected.components.map((component, index) => {
              const label = eventComponents[component.kind].label;
              return (
                <section
                  key={component.id}
                  className="event-component-block"
                  aria-label={`${label} component ${index + 1}`}
                  {...dropProps(selected, component.id)}
                >
                  {canEdit ? (
                    <fieldset
                      className="component-toolbar"
                      aria-label={`${label} layout controls`}
                    >
                      <button
                        type="button"
                        className="button button-quiet component-drag-handle"
                        aria-label={`Drag ${label}`}
                        title="Drag to reorder; or use the move controls"
                        draggable={!save.isPending}
                        disabled={save.isPending}
                        onDragStart={(event) => {
                          if (locked.current) {
                            event.preventDefault();
                            return;
                          }
                          drag.current = {
                            componentId: component.id,
                            source: layout,
                          };
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", label);
                          setDragging(true);
                        }}
                        onDragEnd={endDrag}
                      >
                        <span aria-hidden="true">&#8942;&#8942;</span> {label}
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        aria-label={`Move ${label} up`}
                        disabled={save.isPending || index === 0}
                        onClick={() =>
                          move(
                            component.id,
                            selected.id,
                            selected.components[index - 1]?.id ?? null,
                          )
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        aria-label={`Move ${label} down`}
                        disabled={
                          save.isPending ||
                          index === selected.components.length - 1
                        }
                        onClick={() =>
                          move(
                            component.id,
                            selected.id,
                            selected.components[index + 2]?.id ?? null,
                          )
                        }
                      >
                        Down
                      </button>
                      {layout.pages.length > 1 ? (
                        <select
                          aria-label={`Move ${label} to page`}
                          value=""
                          disabled={save.isPending}
                          onChange={(event) => {
                            if (event.target.value)
                              move(component.id, event.target.value, null);
                          }}
                        >
                          <option value="">Move to page...</option>
                          {layout.pages
                            .filter((page) => page.id !== selected.id)
                            .map((page) => (
                              <option
                                key={page.id}
                                value={page.id}
                                disabled={page.components.length >= 20}
                              >
                                {page.name}
                                {page.components.length >= 20 ? " (full)" : ""}
                              </option>
                            ))}
                        </select>
                      ) : null}
                    </fieldset>
                  ) : null}
                  <EventComponent
                    kind={component.kind}
                    eventId={layout.eventId}
                    canEdit={canEdit}
                  />
                </section>
              );
            })}
          </div>
          {canEdit && dragging ? (
            <div className="component-drop-end" {...dropProps(selected, null)}>
              Drop at end of {selected.name}
            </div>
          ) : null}
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
    </section>
  );
}

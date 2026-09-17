"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import type {
  EventComponentView,
  EventLayoutResponse,
  EventPage,
} from "@chronelle/schemas";
import { ErrorNotice } from "../../components/feedback";
import { PlusIcon } from "../../components/icons";
import {
  describeShownView,
  eventComponents,
  viewOf,
} from "../../lib/event-components";
import {
  moveEventComponent,
  moveEventPage,
  setEventComponentView,
} from "../../lib/event-layout";
import { useUpdateEventLayout } from "../../lib/event-layout-queries";
import { canInsertComponent } from "../../lib/keyboard";
import {
  componentShortcuts,
  useComponentShortcut,
} from "../../lib/use-component-shortcut";
import { EventComponent } from "./event-component";
import type { PageDrop } from "./use-event-pages";
import {
  CommandScope,
  type ContextCommand,
} from "../../components/context-commands";

export function EventPageCanvas({
  layout,
  selected,
  canEdit,
  onSelect,
  onAddPage,
  onAddComponent,
  onRefresh,
  arranging,
  onArrangingChange,
  pageDrop,
}: {
  readonly layout: EventLayoutResponse;
  readonly selected: EventPage | undefined;
  readonly canEdit: boolean;
  readonly onSelect: (pageId: string) => void;
  readonly onAddPage: () => void;
  readonly onAddComponent: () => void;
  readonly onRefresh: () => Promise<unknown>;
  readonly arranging: boolean;
  readonly onArrangingChange: (arranging: boolean) => void;
  readonly pageDrop?: RefObject<PageDrop | null> | undefined;
}) {
  const save = useUpdateEventLayout(layout.eventId);
  const shortcut = useComponentShortcut();
  const locked = useRef(false);
  const drag = useRef<{
    componentId: string;
    source: EventLayoutResponse;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const canArrange = canEdit && layout.pages.length > 0;
  const isArranging = canArrange && arranging;
  useEffect(() => {
    if (canArrange) return;
    onArrangingChange(false);
    drag.current = null;
    setDragging(false);
    setDropTarget(null);
  }, [canArrange, onArrangingChange]);
  const doneButton = useRef<HTMLButtonElement>(null);
  const addComponentButton = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<{
    trigger: HTMLElement | null;
    origin: HTMLElement | null;
    version: number;
    done?: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (
      save.isPending ||
      !focusRequest ||
      layout.version < focusRequest.version
    )
      return;
    if (focusRequest.done) {
      doneButton.current?.focus();
      return;
    }
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
        document.querySelector<HTMLButtonElement>(
          '.event-strip-pages [aria-current="page"]',
        ))
      : trigger;
    target?.focus();
  }, [focusRequest, save.isPending, layout.version]);
  const total = layout.pages.reduce(
    (count, page) => count + page.components.length,
    0,
  );
  const canAdd =
    canEdit && selected && selected.components.length < 20 && total < 100;
  const canAddPage = canEdit && layout.pages.length < 20;
  const commands: ContextCommand[] = [];
  if (canArrange && !save.isPending)
    commands.push(
      isArranging
        ? {
            id: "arrange-layout",
            label: "Done arranging",
            description: "Hide layout controls; moves are already saved",
            target: doneButton,
          }
        : {
            id: "arrange-layout",
            label: "Arrange layout",
            description: "Show page and component move controls",
            run: () => {
              if (locked.current) return;
              endDrag();
              onArrangingChange(true);
              setFocusRequest({
                trigger: null,
                origin: null,
                version: layout.version,
                done: true,
              });
            },
          },
    );
  if (canAdd && selected && !save.isPending)
    commands.push({
      id: "add-component",
      label: "Add component",
      description: `Choose a component for ${selected.name}`,
      target: addComponentButton,
    });
  const selectedIndex = layout.pages.findIndex(
    (page) => page.id === selected?.id,
  );

  function persist(
    source: EventLayoutResponse,
    pages: EventPage[],
    message: string,
    targetPageId?: string,
  ) {
    if (!isArranging || locked.current || pages === source.pages) return;
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
          if (selected) onSelect(targetPageId ?? selected.id);
          if (targetPageId) {
            trigger =
              document.querySelector<HTMLButtonElement>(
                `.event-strip-pages [data-page-id="${targetPageId}"]`,
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

  // A view is part of the page's composition and saves like a move, but it
  // is chosen while reading, so Arrange mode is not required.
  function changeView(componentId: string, view: EventComponentView) {
    if (locked.current) return;
    const pages = setEventComponentView(layout.pages, componentId, view);
    if (pages === layout.pages) return;
    locked.current = true;
    setAnnouncement("");
    save.mutate(
      { expectedVersion: layout.version, pages },
      {
        onSuccess: () => setAnnouncement(describeShownView(view)),
        onSettled: () => {
          locked.current = false;
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

  useEffect(() => {
    if (!pageDrop) return;
    pageDrop.current = {
      allowed: (pageId) => {
        const page = layout.pages.find((item) => item.id === pageId);
        const current = drag.current;
        return (
          page !== undefined &&
          isArranging &&
          !locked.current &&
          current !== null &&
          (page.components.length < 20 ||
            page.components.some((item) => item.id === current.componentId))
        );
      },
      drop: (pageId) => {
        const current = drag.current;
        if (!current) return;
        move(current.componentId, pageId, null, current.source);
        endDrag();
      },
    };
    return () => {
      pageDrop.current = null;
    };
  });

  function dropProps(page: EventPage, beforeId: string | null) {
    const key = beforeId ?? page.id;
    const allowed = () => {
      const current = drag.current;
      return (
        isArranging &&
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
          !canAdd ||
          save.isPending ||
          !canInsertComponent(
            event.nativeEvent,
            event.currentTarget,
            shortcut.value,
          )
        )
          return;
        event.preventDefault();
        onAddComponent();
      }}
    >
      <CommandScope
        pathname={`/events/${layout.eventId}`}
        commands={commands}
      />
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
              {isArranging && layout.pages.length > 1 ? (
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
              {isArranging ? (
                <button
                  ref={doneButton}
                  type="button"
                  className="button button-secondary button-small"
                  disabled={save.isPending}
                  onClick={() => {
                    if (locked.current) return;
                    endDrag();
                    onArrangingChange(false);
                    document
                      .querySelector<HTMLElement>(
                        '.event-strip-menu [aria-haspopup="menu"]',
                      )
                      ?.focus();
                  }}
                >
                  Done arranging
                </button>
              ) : null}
              {canAdd ? (
                <button
                  ref={addComponentButton}
                  type="button"
                  className="button button-quiet button-small"
                  aria-keyshortcuts={componentShortcuts[shortcut.value].keys}
                  disabled={save.isPending}
                  onClick={onAddComponent}
                >
                  Add component
                </button>
              ) : null}
            </div>
          </div>
          {selected.components.length === 0 && !canEdit ? (
            <div className="event-pages-empty">
              <p>No components yet.</p>
            </div>
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
                  {isArranging ? (
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
                    view={viewOf(component)}
                    onChangeView={
                      canEdit
                        ? (view) => changeView(component.id, view)
                        : undefined
                    }
                    isSavingView={save.isPending}
                  />
                </section>
              );
            })}
          </div>
          {isArranging && dragging ? (
            <div className="component-drop-end" {...dropProps(selected, null)}>
              Drop at end of {selected.name}
            </div>
          ) : null}
        </>
      ) : (
        <div className="event-pages-empty">
          {canAddPage ? (
            <button type="button" onClick={onAddPage}>
              <span className="event-pages-empty-mark" aria-hidden="true">
                <PlusIcon />
              </span>
              Add a page
            </button>
          ) : (
            <p>No pages yet.</p>
          )}
        </div>
      )}
    </section>
  );
}

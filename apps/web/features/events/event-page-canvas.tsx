"use client";

import type {
  EventComponentView,
  EventLayoutResponse,
  EventPage,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import {
  type DragEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  CommandScope,
  type ContextCommand,
} from "../../components/context-commands";
import { ErrorNotice } from "../../components/feedback";
import { IconButton } from "../../components/icon-button";
import {
  ArrangeIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from "../../components/icons";
import {
  componentKindLabel,
  describeShownView,
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
import type { LayoutUndoControls, PageDrop } from "./use-event-pages";

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
  layoutUndo,
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
  /** Undo and redo of layout changes for the arrange bar; without them the bar has only Done. */
  readonly layoutUndo?: LayoutUndoControls | undefined;
  readonly pageDrop?: RefObject<PageDrop | null> | undefined;
}) {
  const t = useTranslations("event");
  const tc = useTranslations("canvas");
  const tl = useTranslations("layoutRecovery");
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
            label: tc("doneArranging"),
            description: tc("doneArrangingDescription"),
            target: doneButton,
          }
        : {
            id: "arrange-layout",
            label: tc("arrange"),
            description: tc("arrangeDescription"),
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
      label: tc("addComponent"),
      description: tc("addComponentDescription", { name: selected.name }),
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
      tc("componentMoved", { name: target?.name ?? tc("page") }),
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
      aria-label={tc("pages")}
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
        {save.isPending ? tc("saving") : announcement}
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
                        tc("pageEarlier"),
                      )
                    }
                  >
                    {tc("movePageEarlier")}
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
                        tc("pageLater"),
                      )
                    }
                  >
                    {tc("movePageLater")}
                  </button>
                </>
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
                  {tc("addComponent")}
                </button>
              ) : null}
            </div>
          </div>
          {isArranging ? (
            <fieldset aria-label={tc("arranging")} className="arrange-bar">
              <ArrangeIcon />
              <span className="arrange-bar-title">{tc("arranging")}</span>
              {layoutUndo === undefined ? null : (
                <>
                  <IconButton
                    disabled={!layoutUndo.canUndo}
                    label={tl("undoLabel")}
                    onClick={layoutUndo.onUndo}
                  >
                    <UndoIcon />
                  </IconButton>
                  <IconButton
                    disabled={!layoutUndo.canRedo}
                    label={tl("redoLabel")}
                    onClick={layoutUndo.onRedo}
                  >
                    <RedoIcon />
                  </IconButton>
                </>
              )}
              <button
                ref={doneButton}
                type="button"
                className="arrange-bar-done"
                aria-label={tc("doneArranging")}
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
                {tc("done")}
              </button>
            </fieldset>
          ) : null}
          {selected.components.length === 0 && !canEdit ? (
            <div className="event-pages-empty">
              <p>{tc("noComponents")}</p>
            </div>
          ) : null}
          <div className="event-page-components">
            {selected.components.map((component, index) => {
              const label = componentKindLabel(component.kind);
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
                      aria-label={tc("layoutControls", { name: label })}
                    >
                      <button
                        type="button"
                        className="button button-quiet component-drag-handle"
                        aria-label={tc("drag", { name: label })}
                        title={tc("dragHint")}
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
                        aria-label={tc("moveUp", { name: label })}
                        disabled={save.isPending || index === 0}
                        onClick={() =>
                          move(
                            component.id,
                            selected.id,
                            selected.components[index - 1]?.id ?? null,
                          )
                        }
                      >
                        {tc("up")}
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        aria-label={tc("moveDown", { name: label })}
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
                        {tc("down")}
                      </button>
                      {layout.pages.length > 1 ? (
                        <select
                          aria-label={tc("moveToPageFor", { name: label })}
                          value=""
                          disabled={save.isPending}
                          onChange={(event) => {
                            if (event.target.value)
                              move(component.id, event.target.value, null);
                          }}
                        >
                          <option value="">{tc("moveToPage")}</option>
                          {layout.pages
                            .filter((page) => page.id !== selected.id)
                            .map((page) => (
                              <option
                                key={page.id}
                                value={page.id}
                                disabled={page.components.length >= 20}
                              >
                                {page.components.length >= 20
                                  ? tc("pageFull", { name: page.name })
                                  : page.name}
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
              {tc("dropAtEnd", { name: selected.name })}
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
              {t("addAPage")}
            </button>
          ) : (
            <p>{t("noPages")}</p>
          )}
        </div>
      )}
    </section>
  );
}

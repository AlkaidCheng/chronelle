"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import { AccessLine } from "../../components/access-line";
import { IconButton } from "../../components/icon-button";
import {
  CalendarIcon,
  CalendarPlusIcon,
  ChevronLeftIcon,
  LinkIcon,
  LockIcon,
  MoreIcon,
  PencilIcon,
  ShareIcon,
  TrashIcon,
} from "../../components/icons";
import {
  MenuItem,
  MenuSeparator,
  QuietMenu,
} from "../../components/quiet-menu";
import { formatEventSchedule } from "../../lib/event-schedule";
import { useEventWorkspaceQueries } from "../../lib/queries";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import { isTemporaryReadError } from "../../lib/query-errors";
import {
  eventComponentKindSchema,
  type EventComponentView,
} from "@chronelle/schemas";
import { EventComponent } from "./event-component";
import { EventInspector } from "./event-inspector";
import { SharingPanel } from "./sharing-panel";
import { HistoryButton } from "../history/history-button";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { RemovedLinksPanel } from "../recovery/removed-links-panel";
import {
  eventViewLabel,
  eventViews as tabs,
  type EventView as TabId,
} from "../../lib/event-views";
import { useEventView } from "../../lib/use-event-view";
import { EventOverview } from "./event-overview";
import { EventPages } from "./event-pages";
import { EventStrip } from "./event-strip";
import { useEventPagesState } from "./use-event-pages";
import {
  CommandScope,
  type ContextCommand,
} from "../../components/context-commands";

export function EventWorkspace({ eventId }: { readonly eventId: string }) {
  const t = useTranslations("event");
  const nav = useTranslations("nav");
  const [activeTab, setActiveTab] = useEventView();
  const queries = useEventWorkspaceQueries(eventId, activeTab);
  const canEdit = queries.access.data?.actions.includes("edit") ?? false;
  const pagesState = useEventPagesState(eventId, canEdit);
  const { layout } = pagesState;
  const accessLost =
    (queries.access.data !== undefined && !canEdit) ||
    [queries.event, queries.access].some(
      (query) => query.isError && !isTemporaryReadError(query.error),
    );
  useForgetInaccessibleEventDrafts(eventId, accessLost);
  const [editing, setEditing] = useState<"name" | "schedule" | null>(null);
  const [copied, setCopied] = useState("");
  // A tab's view is chosen for the session; page components save theirs.
  const [tabView, setTabView] = useState<{
    tab: string;
    view: EventComponentView;
  } | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const openLifecycle = useOpenLifecycle();
  const view = useRef<HTMLDivElement>(null);
  const focusView = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The selected view controls when its focus target is mounted.
  useLayoutEffect(() => {
    if (!focusView.current) return;
    view.current?.focus();
    focusView.current = false;
  }, [activeTab]);
  const tabButtons = useRef(new Map<TabId, HTMLButtonElement>());
  const essentialQueries = [queries.event, queries.access];
  const failedQuery =
    essentialQueries.find(
      (query) =>
        query.isError &&
        (query.data === undefined || !isTemporaryReadError(query.error)),
    ) ?? essentialQueries.find((query) => query.isError);

  if (activeTab === null || essentialQueries.some((query) => query.isPending)) {
    return (
      <main className="centered-page workspace-loading">
        <LoadingState label={t("connecting")} />
      </main>
    );
  }

  const refreshNotice =
    failedQuery === undefined ? null : (
      <ErrorNotice
        error={failedQuery.error}
        isRefreshing={essentialQueries.some((query) => query.isFetching)}
        onRefresh={() => {
          for (const query of essentialQueries) void query.refetch();
        }}
      />
    );

  if (
    failedQuery !== undefined &&
    (failedQuery.data === undefined || !isTemporaryReadError(failedQuery.error))
  ) {
    return (
      <main className="workspace-page">
        <Link className="up-link" aria-label={t("allEvents")} href="/events">
          <ChevronLeftIcon />
          {nav("events")}
        </Link>
        {refreshNotice}
      </main>
    );
  }

  const detail = queries.detail.data;
  const access = queries.access.data;
  const event = queries.event.data;
  if (access === undefined || event === undefined) {
    return null;
  }

  const canShare = access.actions.includes("share");
  const canDelete = access.actions.includes("delete");
  const visibleTabs = tabs.filter(
    (tab) => tab.id !== "pages" && (tab.id !== "sharing" || canShare),
  );
  const shownTab =
    activeTab === "sharing" && !canShare ? "overview" : activeTab;
  const schedule = formatEventSchedule(event);
  const commands: ContextCommand[] = [
    ...pagesState.commands,
    {
      id: "event-history",
      label: t("commands.history"),
      description: t("commands.historyDescription", {
        name: event.displayName,
      }),
      target: historyButton,
    },
  ];
  if (canEdit && editing === null)
    commands.push({
      id: "edit-event",
      label: t("commands.edit"),
      description: t("commands.editDescription", { name: event.displayName }),
      target: editButton,
    });
  if (canShare && shownTab !== "sharing")
    commands.push({
      id: "share-event",
      label: t("commands.share"),
      description: t("commands.shareDescription", {
        name: event.displayName,
      }),
      target: shareButton,
    });
  const activeProjection =
    shownTab === "overview" || shownTab === "sharing"
      ? queries.detail
      : undefined;
  const component = eventComponentKindSchema.safeParse(shownTab);

  function copyLink() {
    const href = window.location.href;
    const done = () => setCopied(t("linkCopied"));
    if (navigator.clipboard?.writeText)
      void navigator.clipboard.writeText(href).then(done, () => setCopied(""));
    else done();
  }

  return (
    <main className="event-workspace">
      <CommandScope pathname={`/events/${event.id}`} commands={commands} />
      {refreshNotice}
      <header className="event-hero">
        <Link className="up-link" aria-label={t("allEvents")} href="/events">
          <ChevronLeftIcon />
          {nav("events")}
        </Link>
        <div className="event-title-row">
          <div>
            <h1>{event.displayName}</h1>
            {schedule === "" ? null : (
              <p className="event-date">
                <CalendarIcon />
                {schedule}
              </p>
            )}
            <AccessLine
              onOpenSharing={
                canShare ? () => setActiveTab("sharing") : undefined
              }
              source={access.source}
            />
          </div>
          <div className="event-actions">
            {canEdit && schedule === "" ? (
              <IconButton
                label={t("setDates")}
                onClick={() => setEditing("schedule")}
              >
                <CalendarPlusIcon />
              </IconButton>
            ) : null}
            {canEdit ? (
              <IconButton
                ref={editButton}
                label={t("edit")}
                onClick={() => setEditing("name")}
              >
                <PencilIcon />
              </IconButton>
            ) : (
              <span
                className="icon-control icon-static"
                title={t("viewerAccess")}
              >
                <LockIcon />
                <span className="visually-hidden">{t("viewerAccess")}</span>
              </span>
            )}
            {canShare && shownTab !== "sharing" ? (
              <IconButton
                ref={shareButton}
                label={t("share")}
                onClick={() => {
                  focusView.current = true;
                  setActiveTab("sharing");
                }}
              >
                <ShareIcon />
              </IconButton>
            ) : null}
            <HistoryButton
              ref={historyButton}
              variant="icon"
              objectId={event.id}
              displayName={event.displayName}
            />
            <QuietMenu
              label={t("actionsFor", { name: event.displayName })}
              icon={<MoreIcon />}
            >
              <MenuItem icon={<LinkIcon />} onSelect={copyLink}>
                {t("copyLink")}
              </MenuItem>
              {canDelete ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<TrashIcon />}
                    tone="danger"
                    onSelect={() => openLifecycle(event)}
                  >
                    {t("moveToTrash")}
                  </MenuItem>
                </>
              ) : null}
            </QuietMenu>
          </div>
        </div>
        <p role="status" className="visually-hidden">
          {copied}
        </p>
        {editing !== null && canEdit ? (
          <EventInspector
            key={event.id}
            event={event}
            initialFocus={editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </header>

      <label className="mobile-view-select compact-field">
        <span>{t("viewSelect")}</span>
        <select
          aria-label={t("viewSelect")}
          value={shownTab}
          onChange={(event) => setActiveTab(event.target.value as TabId)}
        >
          <option value="pages">{eventViewLabel("pages")}</option>
          {visibleTabs.map((tab) => (
            <option value={tab.id} key={tab.id}>
              {eventViewLabel(tab.id)}
            </option>
          ))}
        </select>
      </label>
      <EventStrip
        pages={pagesState.pages}
        selectedPageId={pagesState.selectedPage?.id}
        showingPages={shownTab === "pages"}
        onSelectPage={(pageId) => {
          pagesState.selectPage(pageId);
          setActiveTab("pages");
        }}
        canAddPage={pagesState.canAddPage}
        onAddPage={() => {
          setActiveTab("pages");
          pagesState.setAdding({ pageId: null });
        }}
        addPageRef={pagesState.addPageButton}
        pageMenu={pagesState.pageMenu}
        pageDrop={pagesState.pageDrop}
        onInsertComponent={
          pagesState.canAddComponent && pagesState.selectedPage
            ? () => {
                setActiveTab("pages");
                pagesState.setAdding({
                  pageId: pagesState.selectedPage?.id ?? null,
                });
              }
            : undefined
        }
        views={visibleTabs.map((tab) => ({
          id: tab.id,
          label: eventViewLabel(tab.id),
        }))}
        activeView={shownTab}
        onSelectView={setActiveTab}
        tabRef={(tab, element) => {
          if (element === null) tabButtons.current.delete(tab);
          else tabButtons.current.set(tab, element);
        }}
      />
      {shownTab === "pages" ? (
        <EventPages
          key={eventId}
          layout={layout}
          selected={pagesState.selectedPage}
          selectedId={pagesState.selectedPageId}
          canEdit={canEdit}
          onSelect={pagesState.selectPage}
          adding={pagesState.adding}
          onAddingChange={pagesState.setAdding}
          arranging={pagesState.arranging}
          onArrangingChange={pagesState.setArranging}
          pageDrop={pagesState.pageDrop}
        />
      ) : (
        <div
          ref={view}
          tabIndex={-1}
          aria-labelledby={`event-tab-${shownTab}`}
          className="event-view"
          id={`event-panel-${shownTab}`}
          role="tabpanel"
        >
          {activeProjection?.isPending ? (
            <LoadingState label={t("loadingView")} />
          ) : activeProjection?.isError ? (
            <ErrorNotice
              error={activeProjection.error}
              onRefresh={() => void activeProjection.refetch()}
            />
          ) : (
            <>
              {shownTab === "overview" && detail !== undefined ? (
                <EventOverview detail={detail} onOpen={setActiveTab} />
              ) : null}
              {component.success ? (
                <EventComponent
                  key={component.data}
                  kind={component.data}
                  eventId={eventId}
                  canEdit={canEdit}
                  view={
                    tabView?.tab === component.data ? tabView.view : undefined
                  }
                  onChangeView={(view) =>
                    setTabView({ tab: component.data, view })
                  }
                />
              ) : null}
              {shownTab === "sharing" && canShare && detail !== undefined ? (
                <SharingPanel detail={detail} eventId={eventId} />
              ) : null}
              {shownTab === "removed-links" ? (
                <RemovedLinksPanel objectId={eventId} />
              ) : null}
            </>
          )}
        </div>
      )}
      {pagesState.dialog}
    </main>
  );
}

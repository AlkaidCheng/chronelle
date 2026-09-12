"use client";

import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
} from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import { CalendarIcon, LockIcon } from "../../components/icons";
import { formatEventSchedule } from "../../lib/event-schedule";
import { ObjectDetails } from "../../components/object-details";
import { useEventWorkspaceQueries } from "../../lib/queries";
import { useEventDraftStore } from "../../lib/event-draft-context";
import { isTemporaryReadError } from "../../lib/query-errors";
import { eventComponentKindSchema } from "@chronelle/schemas";
import { EventComponent } from "./event-component";
import { EventInspector } from "./event-inspector";
import { SharingPanel } from "./sharing-panel";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { RemovedLinksPanel } from "../recovery/removed-links-panel";
import {
  eventViews as tabs,
  type EventView as TabId,
} from "../../lib/event-views";
import { useEventView } from "../../lib/use-event-view";
import { EventOverview } from "./event-overview";
import { EventPages } from "./event-pages";
import {
  CommandScope,
  type ContextCommand,
} from "../../components/context-commands";

export function EventWorkspace({ eventId }: { readonly eventId: string }) {
  const [activeTab, setActiveTab] = useEventView();
  const queries = useEventWorkspaceQueries(eventId, activeTab);
  const drafts = useEventDraftStore();
  const accessLost =
    (queries.access.data !== undefined &&
      !queries.access.data.actions.includes("edit")) ||
    [queries.event, queries.access].some(
      (query) => query.isError && !isTemporaryReadError(query.error),
    );
  useEffect(() => {
    if (accessLost) drafts.forget(eventId);
  }, [accessLost, drafts, eventId]);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
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
        <LoadingState label="Connecting your event plan" />
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
        <Link className="back-link" href="/events">
          &lt;- All events
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

  const canEdit = access.actions.includes("edit");
  const canShare = access.actions.includes("share");
  const visibleTabs = tabs.filter(
    (tab) => tab.id !== "pages" && (tab.id !== "sharing" || canShare),
  );
  const shownTab =
    activeTab === "sharing" && !canShare ? "overview" : activeTab;
  const commands: ContextCommand[] = [
    {
      id: "event-history",
      label: "Event history",
      description: `Review changes to ${event.displayName}`,
      target: historyButton,
    },
  ];
  if (canEdit && !isEditingEvent)
    commands.push({
      id: "edit-event",
      label: "Edit event",
      description: `Edit ${event.displayName}`,
      target: editButton,
    });
  if (canShare && shownTab !== "sharing")
    commands.push({
      id: "share-event",
      label: "Share event",
      description: `Manage access to ${event.displayName}`,
      target: shareButton,
    });
  const activeProjection =
    shownTab === "overview" || shownTab === "sharing"
      ? queries.detail
      : undefined;
  const component = eventComponentKindSchema.safeParse(shownTab);
  function handleTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tabId: TabId,
  ) {
    const currentIndex = visibleTabs.findIndex((tab) => tab.id === tabId);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % visibleTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleTabs.length - 1;
    }
    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab = visibleTabs[nextIndex];
    if (nextTab !== undefined) {
      setActiveTab(nextTab.id);
      tabButtons.current.get(nextTab.id)?.focus();
    }
  }

  return (
    <main className="event-workspace">
      <CommandScope pathname={`/events/${event.id}`} commands={commands} />
      {refreshNotice}
      <header className="event-hero">
        <div className="event-hero-topline">
          <nav aria-label="Breadcrumb" className="event-breadcrumb">
            <Link className="back-link" href="/events">
              All events
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{event.displayName}</span>
          </nav>
          <ObjectDetails id={event.id} />
        </div>
        <div className="event-title-row">
          <div>
            <h1>{event.displayName}</h1>
            <p className="event-date">
              <CalendarIcon />
              {formatEventSchedule(event)}
            </p>
          </div>
          <div className="event-actions">
            <HistoryButton
              ref={historyButton}
              objectId={event.id}
              displayName={event.displayName}
            />
            {canEdit ? <LifecycleButton target={event} /> : null}
            {canEdit ? (
              <button
                ref={editButton}
                className="button button-secondary"
                onClick={() => setIsEditingEvent(true)}
                type="button"
              >
                Edit event
              </button>
            ) : (
              <span className="read-only-badge">
                <LockIcon /> Viewer access
              </span>
            )}
          </div>
        </div>
        {isEditingEvent && canEdit ? (
          <EventInspector
            key={event.id}
            event={event}
            onClose={() => {
              setIsEditingEvent(false);
            }}
          />
        ) : null}
      </header>

      <div className="event-pages-tools">
        {canShare && shownTab !== "sharing" ? (
          <button
            ref={shareButton}
            type="button"
            className="button button-quiet"
            onClick={() => {
              focusView.current = true;
              setActiveTab("sharing");
            }}
          >
            Share event
          </button>
        ) : null}
        <button
          type="button"
          className="button button-quiet"
          onClick={() =>
            setActiveTab(shownTab === "pages" ? "overview" : "pages")
          }
        >
          {shownTab === "pages" ? "Browse event data" : "Back to pages"}
        </button>
      </div>
      {shownTab === "pages" ? (
        <EventPages key={eventId} eventId={eventId} canEdit={canEdit} />
      ) : (
        <>
          <label className="mobile-view-select compact-field">
            <span>Event view</span>
            <select
              aria-label="Event view"
              value={shownTab}
              onChange={(event) => setActiveTab(event.target.value as TabId)}
            >
              {visibleTabs.map((tab) => (
                <option value={tab.id} key={tab.id}>
                  {tab.label}
                </option>
              ))}
            </select>
          </label>
          <div aria-label="Event views" className="tab-list" role="tablist">
            {visibleTabs.map((tab) => (
              <button
                aria-controls={`event-panel-${tab.id}`}
                aria-selected={shownTab === tab.id}
                className={shownTab === tab.id ? "active" : ""}
                id={`event-tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                ref={(element) => {
                  if (element === null) {
                    tabButtons.current.delete(tab.id);
                  } else {
                    tabButtons.current.set(tab.id, element);
                  }
                }}
                role="tab"
                tabIndex={shownTab === tab.id ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            ref={view}
            tabIndex={-1}
            aria-labelledby={`event-tab-${shownTab}`}
            className="event-view"
            id={`event-panel-${shownTab}`}
            role="tabpanel"
          >
            {activeProjection?.isPending ? (
              <LoadingState label="Loading this view" />
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
        </>
      )}
    </main>
  );
}

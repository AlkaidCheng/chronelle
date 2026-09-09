"use client";

import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import { CalendarIcon, LockIcon } from "../../components/icons";
import { formatEventSchedule } from "../../lib/event-schedule";
import { ObjectDetails } from "../../components/object-details";
import { useEventWorkspaceQueries } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { eventComponentKindSchema } from "@chronelle/schemas";
import { EventComponent } from "./event-component";
import { EventEditorForm } from "./resource-forms";
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

export function EventWorkspace({ eventId }: { readonly eventId: string }) {
  const [activeTab, setActiveTab] = useEventView();
  const queries = useEventWorkspaceQueries(eventId, activeTab);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
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
              objectId={event.id}
              displayName={event.displayName}
            />
            {canEdit ? <LifecycleButton target={event} /> : null}
            {canEdit ? (
              <button
                className="button button-secondary"
                onClick={() => setIsEditingEvent((value) => !value)}
                type="button"
              >
                {isEditingEvent ? "Close editor" : "Edit event"}
              </button>
            ) : (
              <span className="read-only-badge">
                <LockIcon /> Viewer access
              </span>
            )}
          </div>
        </div>
        {isEditingEvent && canEdit ? (
          <div className="event-editor surface">
            <EventEditorForm
              event={event}
              onCancel={() => setIsEditingEvent(false)}
            />
          </div>
        ) : null}
      </header>

      <div className="event-pages-tools">
        {canShare && shownTab !== "sharing" ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setActiveTab("sharing")}
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

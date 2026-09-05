"use client";

import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  PaperclipIcon,
  WalletIcon,
} from "../../components/icons";
import { formatDateTime, formatMoney, shortId } from "../../lib/format";
import { useEventWorkspaceQueries } from "../../lib/queries";
import {
  CalendarPanel,
  ExpensesPanel,
  ItineraryPanel,
  RemindersPanel,
  TasksPanel,
  TimelinePanel,
} from "./planning-panels";
import { DocumentsPanel } from "./documents-panel";
import { EventEditorForm } from "./resource-forms";
import { SharingPanel } from "./sharing-panel";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { RemovedLinksPanel } from "../recovery/removed-links-panel";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "todos", label: "To-dos" },
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
  { id: "itinerary", label: "Itinerary" },
  { id: "expenses", label: "Expenses" },
  { id: "reminders", label: "Reminders" },
  { id: "files", label: "Files" },
  { id: "sharing", label: "Sharing" },
  { id: "removed-links", label: "Removed links" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function OverviewCard({
  count,
  icon,
  label,
  onOpen,
}: {
  readonly count: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onOpen: () => void;
}) {
  return (
    <button className="overview-card" onClick={onOpen} type="button">
      <span className="overview-icon">{icon}</span>
      <span>{label}</span>
      <strong>{count}</strong>
      <span aria-hidden="true" className="card-arrow">
        -&gt;
      </span>
    </button>
  );
}

export function EventWorkspace({ eventId }: { readonly eventId: string }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const queries = useEventWorkspaceQueries(eventId, activeTab);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const tabButtons = useRef(new Map<TabId, HTMLButtonElement>());
  const essentialQueries = [queries.detail, queries.access];
  const firstError = essentialQueries.find((query) => query.isError)?.error;

  if (essentialQueries.some((query) => query.isPending)) {
    return (
      <main className="centered-page workspace-loading">
        <LoadingState label="Connecting your event plan" />
      </main>
    );
  }

  if (firstError !== undefined) {
    return (
      <main className="workspace-page">
        <Link className="back-link" href="/events">
          &lt;- All events
        </Link>
        <ErrorNotice
          error={firstError}
          onRefresh={() => {
            for (const query of essentialQueries) {
              void query.refetch();
            }
          }}
        />
      </main>
    );
  }

  const detail = queries.detail.data;
  const access = queries.access.data;
  const todos = queries.todos.data;
  const calendar = queries.calendar.data;
  const timeline = queries.timeline.data;
  const itinerary = queries.itinerary.data;
  const expenses = queries.expenses.data;
  const reminders = queries.reminders.data;
  if (access === undefined || detail === undefined) {
    return null;
  }

  const event = detail.event;
  const canEdit = access.actions.includes("edit");
  const canShare = access.actions.includes("share");
  const visibleTabs = tabs.filter((tab) => tab.id !== "sharing" || canShare);
  const shownTab =
    activeTab === "sharing" && !canShare ? "overview" : activeTab;
  if (shownTab !== activeTab) {
    setActiveTab(shownTab);
  }
  const activeProjection = {
    overview: queries.timeline,
    todos: queries.todos,
    calendar: queries.calendar,
    timeline: queries.timeline,
    itinerary: queries.itinerary,
    expenses: queries.expenses,
    reminders: queries.reminders,
    files: undefined,
    sharing: undefined,
    "removed-links": undefined,
  }[shownTab];
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
  const openTasks = detail.tasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  );
  const expenseCurrencies = new Set(
    detail.expenses.map((expense) => expense.currency),
  );
  const expenseSummary =
    expenseCurrencies.size === 1 && detail.expenses[0] !== undefined
      ? formatMoney(
          String(
            detail.expenses.reduce(
              (sum, expense) => sum + Number(expense.amount),
              0,
            ),
          ),
          detail.expenses[0].currency,
        )
      : `${detail.expenses.length} transaction${detail.expenses.length === 1 ? "" : "s"}`;

  return (
    <main className="event-workspace">
      <header className="event-hero">
        <div className="event-hero-topline">
          <Link className="back-link" href="/events">
            &lt;- All events
          </Link>
          <span className="canonical-badge" title={event.id}>
            Canonical ID {shortId(event.id)}
          </span>
        </div>
        <div className="event-title-row">
          <div>
            <p className="eyebrow">Event workspace</p>
            <h1>{event.displayName}</h1>
            <p className="event-date">
              <CalendarIcon />
              {event.startsAt === null
                ? "Schedule to be decided"
                : `${formatDateTime(event.startsAt)}${
                    event.endsAt === null
                      ? ""
                      : ` to ${formatDateTime(event.endsAt)}`
                  }`}
            </p>
          </div>
          <HistoryButton objectId={event.id} displayName={event.displayName} />
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
        {isEditingEvent && canEdit ? (
          <div className="event-editor surface">
            <EventEditorForm
              event={event}
              onCancel={() => setIsEditingEvent(false)}
            />
          </div>
        ) : null}
      </header>

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
            {shownTab === "overview" && timeline !== undefined ? (
              <section className="planning-panel overview-panel">
                <div className="overview-intro">
                  <span className="object-label">At a glance</span>
                  <h2>Your event, connected.</h2>
                  <p>
                    Each card is a view over the canonical objects in this
                    event. Changes flow across the workspace without copied
                    records.
                  </p>
                </div>
                {detail.lockedRelationCount > 0 ? (
                  <div className="locked-reference surface-subtle">
                    <LockIcon />
                    <div>
                      <strong>Private related items</strong>
                      <p>
                        {detail.lockedRelationCount} related
                        {detail.lockedRelationCount === 1
                          ? " item is"
                          : " items are"}{" "}
                        outside your permission scope.
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="overview-grid">
                  <OverviewCard
                    count={String(openTasks.length)}
                    icon={<CheckIcon />}
                    label="Open to-dos"
                    onOpen={() => setActiveTab("todos")}
                  />
                  <OverviewCard
                    count={String(
                      detail.events.filter((item) => item.startsAt !== null)
                        .length,
                    )}
                    icon={<CalendarIcon />}
                    label="Scheduled items"
                    onOpen={() => setActiveTab("calendar")}
                  />
                  <OverviewCard
                    count={expenseSummary}
                    icon={<WalletIcon />}
                    label="Recorded expenses"
                    onOpen={() => setActiveTab("expenses")}
                  />
                  <OverviewCard
                    count={String(detail.reminders.length)}
                    icon={<BellIcon />}
                    label="Reminders"
                    onOpen={() => setActiveTab("reminders")}
                  />
                  <OverviewCard
                    count={String(detail.documents.length)}
                    icon={<PaperclipIcon />}
                    label="Event files"
                    onOpen={() => setActiveTab("files")}
                  />
                </div>
                <div className="next-up surface-subtle">
                  <ClockIcon />
                  <div>
                    <span className="object-label">Next on the timeline</span>
                    {timeline.items[0] === undefined ? (
                      <p>
                        Add a dated task, schedule item, expense, or reminder.
                      </p>
                    ) : (
                      <>
                        <h3>{timeline.items[0].displayName}</h3>
                        <p>{formatDateTime(timeline.items[0].occursAt)}</p>
                      </>
                    )}
                  </div>
                </div>
              </section>
            ) : null}
            {shownTab === "todos" && todos !== undefined ? (
              <TasksPanel
                canEdit={canEdit}
                eventId={eventId}
                tasks={todos.items}
              />
            ) : null}
            {shownTab === "calendar" && calendar !== undefined ? (
              <CalendarPanel
                canEdit={canEdit}
                eventId={eventId}
                items={calendar.items}
              />
            ) : null}
            {shownTab === "timeline" && timeline !== undefined ? (
              <TimelinePanel timeline={timeline} />
            ) : null}
            {shownTab === "itinerary" && itinerary !== undefined ? (
              <ItineraryPanel items={itinerary.items} />
            ) : null}
            {shownTab === "expenses" && expenses !== undefined ? (
              <ExpensesPanel
                canEdit={canEdit}
                eventId={eventId}
                expenses={expenses.items}
              />
            ) : null}
            {shownTab === "reminders" && reminders !== undefined ? (
              <RemindersPanel
                canEdit={canEdit}
                eventId={eventId}
                reminders={reminders.items}
              />
            ) : null}
            {shownTab === "files" ? (
              <DocumentsPanel
                canEdit={canEdit}
                event={event}
                expenses={detail.expenses}
                tasks={detail.tasks}
              />
            ) : null}
            {shownTab === "sharing" && canShare ? (
              <SharingPanel detail={detail} eventId={eventId} />
            ) : null}
            {shownTab === "removed-links" ? (
              <RemovedLinksPanel objectId={eventId} />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

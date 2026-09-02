"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
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
import { EventEditorForm } from "./resource-forms";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "todos", label: "To-dos" },
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
  { id: "itinerary", label: "Itinerary" },
  { id: "expenses", label: "Expenses" },
  { id: "reminders", label: "Reminders" },
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
  const queries = useEventWorkspaceQueries(eventId);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const allQueries = Object.values(queries);
  const firstError = allQueries.find((query) => query.isError)?.error;

  if (allQueries.some((query) => query.isPending)) {
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
            for (const query of allQueries) {
              void query.refetch();
            }
          }}
        />
      </main>
    );
  }

  const detail = queries.detail.data;
  const todos = queries.todos.data;
  const calendar = queries.calendar.data;
  const timeline = queries.timeline.data;
  const itinerary = queries.itinerary.data;
  const expenses = queries.expenses.data;
  const reminders = queries.reminders.data;
  if (
    detail === undefined ||
    todos === undefined ||
    calendar === undefined ||
    timeline === undefined ||
    itinerary === undefined ||
    expenses === undefined ||
    reminders === undefined
  ) {
    return null;
  }

  const event = detail.event;
  const openTasks = todos.items.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  );
  const expenseCurrencies = new Set(
    expenses.items.map((expense) => expense.currency),
  );
  const expenseSummary =
    expenseCurrencies.size === 1 && expenses.items[0] !== undefined
      ? formatMoney(
          String(
            expenses.items.reduce(
              (sum, expense) => sum + Number(expense.amount),
              0,
            ),
          ),
          expenses.items[0].currency,
        )
      : `${expenses.items.length} transaction${expenses.items.length === 1 ? "" : "s"}`;

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
          <button
            className="button button-secondary"
            onClick={() => setIsEditingEvent((value) => !value)}
            type="button"
          >
            {isEditingEvent ? "Close editor" : "Edit event"}
          </button>
        </div>
        {isEditingEvent ? (
          <div className="event-editor surface">
            <EventEditorForm
              event={event}
              eventId={eventId}
              onCancel={() => setIsEditingEvent(false)}
            />
          </div>
        ) : null}
      </header>

      <nav aria-label="Event views" className="tab-list">
        {tabs.map((tab) => (
          <button
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="event-view">
        {activeTab === "overview" ? (
          <section className="planning-panel overview-panel">
            <div className="overview-intro">
              <span className="object-label">At a glance</span>
              <h2>Your event, connected.</h2>
              <p>
                Each card is a view over the canonical objects in this event.
                Changes flow across the workspace without copied records.
              </p>
            </div>
            <div className="overview-grid">
              <OverviewCard
                count={String(openTasks.length)}
                icon={<CheckIcon />}
                label="Open to-dos"
                onOpen={() => setActiveTab("todos")}
              />
              <OverviewCard
                count={String(calendar.items.length)}
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
                count={String(reminders.items.length)}
                icon={<BellIcon />}
                label="Reminders"
                onOpen={() => setActiveTab("reminders")}
              />
            </div>
            <div className="next-up surface-subtle">
              <ClockIcon />
              <div>
                <span className="object-label">Next on the timeline</span>
                {timeline.items[0] === undefined ? (
                  <p>Add a dated task, schedule item, expense, or reminder.</p>
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
        {activeTab === "todos" ? (
          <TasksPanel eventId={eventId} tasks={todos.items} />
        ) : null}
        {activeTab === "calendar" ? (
          <CalendarPanel eventId={eventId} items={calendar.items} />
        ) : null}
        {activeTab === "timeline" ? (
          <TimelinePanel timeline={timeline} />
        ) : null}
        {activeTab === "itinerary" ? (
          <ItineraryPanel items={itinerary.items} />
        ) : null}
        {activeTab === "expenses" ? (
          <ExpensesPanel eventId={eventId} expenses={expenses.items} />
        ) : null}
        {activeTab === "reminders" ? (
          <RemindersPanel eventId={eventId} reminders={reminders.items} />
        ) : null}
      </div>
    </main>
  );
}

"use client";

import type { EventListQuery, EventResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import {
  ArrowIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
} from "../../components/icons";
import { eventPeriod } from "../../lib/event-collection";
import {
  formatEventDatePart,
  formatEventSchedule,
} from "../../lib/event-schedule";
import { useEventsQuery } from "../../lib/queries";
import { CreateEventDialog } from "./create-event-dialog";

function EventCard({
  event,
  now,
}: {
  readonly event: EventResponse;
  readonly now: number;
}) {
  return (
    <Link className="event-card" href={`/events/${event.id}`}>
      <div className="event-date-mark">
        <span>{formatEventDatePart(event, "month").toUpperCase()}</span>
        <strong>{formatEventDatePart(event, "day")}</strong>
      </div>
      <div className="event-card-copy">
        <span className={`object-label period-${eventPeriod(event, now)}`}>
          {eventPeriod(event, now) === "upcoming"
            ? "Scheduled"
            : eventPeriod(event, now) === "past"
              ? "Past event"
              : "Date to be decided"}
        </span>
        <h2>{event.displayName}</h2>
        <p>{formatEventSchedule(event)}</p>
      </div>
      <span aria-hidden="true" className="card-arrow">
        <ArrowIcon />
      </span>
    </Link>
  );
}

export function EventList() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<EventListQuery["filter"]>("all");
  const [sort, setSort] = useState<EventListQuery["sort"]>("date");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const events = useEventsQuery({ query: debouncedQuery, filter, sort });
  const changingQuery = query.trim() !== debouncedQuery;
  const items = changingQuery ? [] : (events.data?.items ?? []);
  const now = Date.parse(events.data?.asOf ?? "");
  const filtered = debouncedQuery !== "" || filter !== "all";
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  useEffect(() => {
    try {
      if (window.localStorage.getItem("chronelle.event-layout") === "list")
        setLayout("list");
    } catch {
      /* Layout remains usable when browser storage is unavailable. */
    }
  }, []);

  function changeLayout(value: "grid" | "list") {
    setLayout(value);
    try {
      window.localStorage.setItem("chronelle.event-layout", value);
    } catch {
      /* Persistence is optional; no event data is stored here. */
    }
  }

  return (
    <main className="workspace-page">
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">Make room for what matters</p>
          <h1>Events</h1>
          <p>
            From the first idea to the final detail. Keep your plans together.
          </p>
        </div>
        <button
          aria-haspopup="dialog"
          className="button button-primary"
          onClick={(event) => {
            event.currentTarget.focus();
            setIsCreating(true);
          }}
          type="button"
        >
          <PlusIcon />
          New event
        </button>
      </header>

      {isCreating ? (
        <CreateEventDialog
          onClose={() => setIsCreating(false)}
          onCreated={(id) => router.push(`/events/${id}`)}
        />
      ) : null}

      <section
        aria-labelledby="event-list-heading"
        className="event-list-section"
      >
        <div className="collection-toolbar">
          <label className="collection-search">
            <SearchIcon />
            <span className="visually-hidden">Filter events by name</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find an event..."
              maxLength={240}
            />
          </label>
          <label className="compact-field collection-sort">
            <span className="visually-hidden">Sort events</span>
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as EventListQuery["sort"])
              }
            >
              <option value="date">Event date</option>
              <option value="updated">Recently updated</option>
              <option value="name">Name A-Z</option>
            </select>
          </label>
          <fieldset className="segmented-control" aria-label="Event layout">
            <button
              aria-label="Grid view"
              aria-pressed={layout === "grid"}
              type="button"
              onClick={() => changeLayout("grid")}
            >
              <GridIcon />
            </button>
            <button
              aria-label="List view"
              aria-pressed={layout === "list"}
              type="button"
              onClick={() => changeLayout("list")}
            >
              <ListIcon />
            </button>
          </fieldset>
          <button
            className="button button-quiet"
            type="button"
            disabled={events.isFetching || changingQuery}
            onClick={() => void events.refresh()}
          >
            Refresh events
          </button>
        </div>
        <div className="collection-heading">
          <fieldset className="filter-row" aria-label="Filter events">
            {(["all", "upcoming", "unscheduled", "past"] as const).map(
              (value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value === "all"
                    ? "All events"
                    : value === "upcoming"
                      ? "Upcoming & ongoing"
                      : value}
                </button>
              ),
            )}
          </fieldset>
          <p
            aria-label="Event count"
            className="collection-count"
            role="status"
          >
            {events.data && !changingQuery
              ? `${items.length} ${items.length === 1 ? "event" : "events"} loaded`
              : ""}
          </p>
        </div>
        <div className="visually-hidden">
          <h2 id="event-list-heading">All events</h2>
        </div>
        {events.isPending || changingQuery ? (
          <LoadingState label="Loading events" />
        ) : null}
        {events.isError ? (
          <ErrorNotice
            error={events.error}
            onRefresh={() =>
              void (events.isFetchNextPageError
                ? events.fetchNextPage()
                : events.refresh())
            }
          />
        ) : null}
        {!changingQuery &&
        !events.isError &&
        events.data?.items.length === 0 &&
        !filtered ? (
          <EmptyState
            description="Choose New event to start a gathering, a project, or a day worth planning. Add the details as they take shape."
            title="Your first event starts here"
          />
        ) : null}
        {!changingQuery &&
        !events.isError &&
        events.data &&
        items.length === 0 &&
        filtered ? (
          <div className="collection-empty">
            <EmptyState
              title="No matching events"
              description="Try another name or change your filters."
            />
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}
        <div className={`event-grid event-layout-${layout}`}>
          {items.map((event) => (
            <EventCard event={event} now={now} key={event.id} />
          ))}
        </div>
        {!changingQuery && events.hasNextPage ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={events.isFetching}
            onClick={() => void events.fetchNextPage()}
          >
            {events.isFetchingNextPage
              ? "Loading more events..."
              : "Load more events"}
          </button>
        ) : null}
      </section>
    </main>
  );
}

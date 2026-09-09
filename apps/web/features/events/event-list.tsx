"use client";

import type { EventListQuery, EventResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEventHandler, useEffect, useState } from "react";

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
  useEventCollectionReturn,
  useEventCollectionState,
} from "../../lib/event-collection-state";
import {
  formatEventDatePart,
  formatEventSchedule,
} from "../../lib/event-schedule";
import { useEventsQuery } from "../../lib/queries";
import { CreateEventDialog } from "./create-event-dialog";

function EventCard({
  event,
  now,
  onOpen,
}: {
  readonly event: EventResponse;
  readonly now: number;
  readonly onOpen: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      className="event-card"
      data-event-id={event.id}
      href={`/events/${event.id}`}
      onClick={onOpen}
    >
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
  const { criteria, change, layout, changeLayout } = useEventCollectionState();
  const { query, filter, sort } = criteria;
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [isComposing, setIsComposing] = useState(false);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  const events = useEventsQuery({ query: debouncedQuery, filter, sort });
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const { container, remember } = useEventCollectionReturn(
    events.isSuccess && !events.isFetching && !changingQuery,
  );
  const items = changingQuery ? [] : (events.data?.items ?? []);
  const now = Date.parse(events.data?.asOf ?? "");
  const filtered = debouncedQuery !== "" || filter !== "all";
  return (
    <main className="workspace-page" ref={container} tabIndex={-1}>
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
              onChange={(event) => change({ query: event.target.value })}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                change({ query: event.currentTarget.value });
                setIsComposing(false);
              }}
              placeholder="Find an event..."
              maxLength={240}
            />
          </label>
          <label className="compact-field collection-sort">
            <span className="visually-hidden">Sort events</span>
            <select
              value={sort}
              onChange={(event) =>
                change({ sort: event.target.value as EventListQuery["sort"] })
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
            onClick={() => {
              change({});
              void events.refresh();
            }}
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
                  onClick={() => change({ filter: value })}
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
            description="Choose New event and give it a name. Dates are optional. Add pages and components as your plans take shape."
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
                change({ query: "", filter: "all" });
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}
        <div className={`event-grid event-layout-${layout}`}>
          {items.map((event) => (
            <EventCard
              event={event}
              now={now}
              key={event.id}
              onOpen={(click) => remember(event.id, click)}
            />
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

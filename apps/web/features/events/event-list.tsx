"use client";

import type { EventResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

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
import { formatDateTime, fromDateTimeInput } from "../../lib/format";
import { useCreateEvent, useEventsQuery } from "../../lib/queries";
import {
  type EventFilter,
  type EventSort,
  eventPeriod,
  selectEvents,
} from "../../lib/event-collection";
import { useClock } from "../../lib/use-clock";

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
        <span>
          {event.startsAt === null
            ? "TBD"
            : new Intl.DateTimeFormat(undefined, { month: "short" })
                .format(new Date(event.startsAt))
                .toUpperCase()}
        </span>
        <strong>
          {event.startsAt === null
            ? "-"
            : new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(
                new Date(event.startsAt),
              )}
        </strong>
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
        <p>{formatDateTime(event.startsAt)}</p>
      </div>
      <span aria-hidden="true" className="card-arrow">
        <ArrowIcon />
      </span>
    </Link>
  );
}

function CreateEventForm({
  onCreated,
}: {
  readonly onCreated: (id: string) => void;
}) {
  const createEvent = useCreateEvent();
  const [displayName, setDisplayName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createEvent.mutate(
      {
        displayName,
        startsAt: fromDateTimeInput(startsAt),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      {
        onSuccess: (created) => {
          setDisplayName("");
          setStartsAt("");
          onCreated(created.id);
        },
      },
    );
  }

  return (
    <form className="create-event-form" onSubmit={handleSubmit}>
      <div className="compact-field grow-field">
        <label htmlFor="event-name">Event name</label>
        <input
          ref={nameInput}
          id="event-name"
          maxLength={240}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Summer gathering"
          required
          value={displayName}
        />
      </div>
      <div className="compact-field">
        <label htmlFor="event-start">Starts (optional)</label>
        <input
          id="event-start"
          onChange={(event) => setStartsAt(event.target.value)}
          type="datetime-local"
          value={startsAt}
        />
      </div>
      <button
        className="button button-primary"
        disabled={createEvent.isPending}
        type="submit"
      >
        {createEvent.isPending ? "Creating..." : "Create event"}
      </button>
      {createEvent.isError ? <ErrorNotice error={createEvent.error} /> : null}
    </form>
  );
}

export function EventList() {
  const events = useEventsQuery();
  const router = useRouter();
  const now = useClock();
  const [isCreating, setIsCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EventFilter>("all");
  const [sort, setSort] = useState<EventSort>("date");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("chronelle.event-layout") === "list")
        setLayout("list");
    } catch {
      /* Layout remains usable when browser storage is unavailable. */
    }
  }, []);
  const items = selectEvents(events.data?.items ?? [], {
    query,
    filter,
    sort,
    now,
  });

  function changeLayout(value: "grid" | "list") {
    setLayout(value);
    try {
      window.localStorage.setItem("chronelle.event-layout", value);
    } catch {
      /* Persistence is optional; no event data is stored here. */
    }
  }

  function closeCreate() {
    setIsCreating(false);
    createButton.current?.focus();
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
          ref={createButton}
          aria-expanded={isCreating}
          aria-controls="create-event"
          className="button button-primary"
          onClick={() => setIsCreating(!isCreating)}
          type="button"
        >
          <PlusIcon />
          New event
        </button>
      </header>

      {isCreating ? (
        <section
          aria-labelledby="new-event-heading"
          className="surface create-surface"
          id="create-event"
        >
          <div className="section-title-row">
            <h2 id="new-event-heading">Create an event</h2>
            <button
              className="button button-quiet"
              type="button"
              onClick={closeCreate}
            >
              Cancel
            </button>
          </div>
          <CreateEventForm onCreated={(id) => router.push(`/events/${id}`)} />
        </section>
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
              onChange={(event) => setSort(event.target.value as EventSort)}
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
            {events.data
              ? `${items.length} of ${events.data.items.length} events`
              : ""}
          </p>
        </div>
        <div className="visually-hidden">
          <h2 id="event-list-heading">All events</h2>
        </div>
        {events.isPending ? <LoadingState label="Loading events" /> : null}
        {events.isError ? (
          <ErrorNotice
            error={events.error}
            onRefresh={() => void events.refetch()}
          />
        ) : null}
        {events.data?.items.length === 0 ? (
          <EmptyState
            description="Choose New event to start a gathering, a project, or a day worth planning. Add the details as they take shape."
            title="Your first event starts here"
          />
        ) : null}
        {events.data && events.data.items.length > 0 && items.length === 0 ? (
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
      </section>
    </main>
  );
}

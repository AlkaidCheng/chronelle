"use client";

import type { EventResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { CalendarIcon } from "../../components/icons";
import { formatDateTime, fromDateTimeInput } from "../../lib/format";
import { useCreateEvent, useEventsQuery } from "../../lib/queries";

function EventCard({ event }: { readonly event: EventResponse }) {
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
        <span className="object-label">Event</span>
        <h2>{event.displayName}</h2>
        <p>{formatDateTime(event.startsAt)}</p>
      </div>
      <span aria-hidden="true" className="card-arrow">
        -&gt;
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
          id="event-name"
          maxLength={240}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Summer gathering"
          required
          value={displayName}
        />
      </div>
      <div className="compact-field">
        <label htmlFor="event-start">Starts</label>
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

  return (
    <main className="workspace-page">
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">Your plans</p>
          <h1>Events</h1>
          <p>
            One place for the work, timing, costs, and reminders around every
            event.
          </p>
        </div>
        <CalendarIcon className="heading-icon" />
      </header>

      <section
        aria-labelledby="new-event-heading"
        className="surface create-surface"
      >
        <div>
          <span className="object-label">Start something</span>
          <h2 id="new-event-heading">Create an event</h2>
        </div>
        <CreateEventForm onCreated={(id) => router.push(`/events/${id}`)} />
      </section>

      <section
        aria-labelledby="event-list-heading"
        className="event-list-section"
      >
        <div className="section-title-row">
          <h2 id="event-list-heading">All events</h2>
          <span>{events.data?.items.length ?? 0}</span>
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
            description="Create an event above, then connect tasks, schedule items, expenses, and reminders."
            title="Your first event starts here"
          />
        ) : null}
        <div className="event-grid">
          {events.data?.items.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>
      </section>
    </main>
  );
}

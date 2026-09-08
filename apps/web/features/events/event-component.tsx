"use client";

import type { ReactNode } from "react";
import type { EventComponentKind } from "@chronelle/schemas";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { eventComponents } from "../../lib/event-components";
import { queryKeys } from "../../lib/queries";
import { DocumentsPanel } from "./documents-panel";
import {
  CalendarPanel,
  ExpensesPanel,
  ItineraryPanel,
  RemindersPanel,
  TasksPanel,
  TimelinePanel,
} from "./planning-panels";

function Projection<T>({
  queryKey,
  load,
  label,
  children,
}: {
  readonly queryKey: readonly string[];
  readonly load: (signal: AbortSignal) => Promise<T>;
  readonly label: string;
  readonly children: (projection: T) => ReactNode;
}) {
  const { credential } = useAuthSession();
  const query = useQuery({
    queryKey,
    enabled: credential !== null,
    queryFn: ({ signal }) => load(signal),
  });
  if (query.isError)
    return (
      <ErrorNotice error={query.error} onRefresh={() => void query.refetch()} />
    );
  if (query.isPending)
    return <LoadingState label={`Loading ${label.toLowerCase()}`} />;
  return children(query.data);
}

export function EventComponent({
  kind,
  eventId,
  canEdit,
}: {
  readonly kind: EventComponentKind;
  readonly eventId: string;
  readonly canEdit: boolean;
}) {
  const client = useApiClient();
  const label = eventComponents[kind].label;
  switch (kind) {
    case "todos":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.todos(eventId)}
          load={(signal) => client.withSignal(signal).getEventTodos(eventId)}
        >
          {(tasks) => (
            <TasksPanel
              eventId={eventId}
              canEdit={canEdit}
              tasks={tasks.items}
            />
          )}
        </Projection>
      );
    case "calendar":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.calendar(eventId)}
          load={(signal) => client.withSignal(signal).getEventCalendar(eventId)}
        >
          {(calendar) => (
            <CalendarPanel
              eventId={eventId}
              canEdit={canEdit}
              items={calendar.items}
            />
          )}
        </Projection>
      );
    case "timeline":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.timeline(eventId)}
          load={(signal) => client.withSignal(signal).getEventTimeline(eventId)}
        >
          {(timeline) => <TimelinePanel timeline={timeline} />}
        </Projection>
      );
    case "itinerary":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.itinerary(eventId)}
          load={(signal) =>
            client.withSignal(signal).getEventItinerary(eventId)
          }
        >
          {(itinerary) => <ItineraryPanel items={itinerary.items} />}
        </Projection>
      );
    case "expenses":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.expenses(eventId)}
          load={(signal) => client.withSignal(signal).getEventExpenses(eventId)}
        >
          {(expenses) => (
            <ExpensesPanel
              eventId={eventId}
              canEdit={canEdit}
              expenses={expenses.items}
            />
          )}
        </Projection>
      );
    case "reminders":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.reminders(eventId)}
          load={(signal) =>
            client.withSignal(signal).getEventReminders(eventId)
          }
        >
          {(reminders) => (
            <RemindersPanel
              eventId={eventId}
              canEdit={canEdit}
              reminders={reminders.items}
            />
          )}
        </Projection>
      );
    case "files":
      return (
        <Projection
          label={label}
          queryKey={queryKeys.detail(eventId)}
          load={(signal) => client.withSignal(signal).getEventDetail(eventId)}
        >
          {(detail) => (
            <DocumentsPanel
              event={detail.event}
              canEdit={canEdit}
              tasks={detail.tasks}
              expenses={detail.expenses}
            />
          )}
        </Projection>
      );
  }
}

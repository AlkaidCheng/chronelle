"use client";

import type {
  EventComponentKind,
  EventComponentView,
} from "@chronelle/schemas";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { tr } from "../../i18n/active-locale";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import {
  componentKindLabel,
  resolveEventComponent,
} from "../../lib/event-components";
import { queryKeys } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { DocumentsPanel } from "./documents-panel";
import { PeoplePanel } from "./people-panel";
import {
  CalendarPanel,
  ExpensesPanel,
  RemindersPanel,
  TasksPanel,
  TimelinePanel,
} from "./planning-panels";

function Projection<T>({
  eventId,
  queryKey,
  load,
  label,
  children,
}: {
  readonly eventId: string;
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
  useForgetInaccessibleEventDrafts(
    eventId,
    query.isError && !isTemporaryReadError(query.error),
  );
  if (query.isPending)
    return (
      <LoadingState
        label={tr("views")("loading", { name: label.toLowerCase() })}
      />
    );
  return (
    <>
      {query.isError ? (
        <ErrorNotice
          error={query.error}
          onRefresh={() => void query.refetch()}
          isRefreshing={query.isFetching}
          refreshLabel="Refresh latest"
        />
      ) : null}
      {query.data !== undefined &&
      (!query.isError || isTemporaryReadError(query.error))
        ? children(query.data)
        : null}
    </>
  );
}

export function EventComponent({
  kind: storedKind,
  eventId,
  canEdit,
  view: storedView,
  onChangeView,
  isSavingView = false,
}: {
  readonly kind: EventComponentKind;
  readonly eventId: string;
  readonly canEdit: boolean;
  /** The layout's view for this component; the kind's default when absent. */
  readonly view?: EventComponentView | undefined;
  /** Records a chosen view in the layout; absent when the layout is read-only. */
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly isSavingView?: boolean;
}) {
  const client = useApiClient();
  useForgetInaccessibleEventDrafts(eventId, !canEdit);
  // A retired kind renders as the kind and view it stands for.
  const { kind, view } = resolveEventComponent({
    kind: storedKind,
    view: storedView,
  });
  const label = componentKindLabel(kind);
  switch (kind) {
    case "todos":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.todos(eventId)}
          load={(signal) => client.withSignal(signal).getEventTodos(eventId)}
        >
          {(tasks) => (
            <TasksPanel
              eventId={eventId}
              canEdit={canEdit}
              isSavingView={isSavingView}
              onChangeView={onChangeView}
              tasks={tasks.items}
              view={view}
            />
          )}
        </Projection>
      );
    case "calendar":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.calendar(eventId)}
          load={(signal) => client.withSignal(signal).getEventCalendar(eventId)}
        >
          {(calendar) => (
            <CalendarPanel
              eventId={eventId}
              canEdit={canEdit}
              isSavingView={isSavingView}
              items={calendar.items}
              onChangeView={onChangeView}
              view={view}
            />
          )}
        </Projection>
      );
    case "timeline":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.timeline(eventId)}
          load={(signal) => client.withSignal(signal).getEventTimeline(eventId)}
        >
          {(timeline) => <TimelinePanel timeline={timeline} />}
        </Projection>
      );
    case "itinerary":
      // Resolved to the Calendar above; kept for the exhaustive switch.
      return null;
    case "expenses":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.expenses(eventId)}
          load={(signal) => client.withSignal(signal).getEventExpenses(eventId)}
        >
          {(expenses) => (
            <ExpensesPanel
              eventId={eventId}
              canEdit={canEdit}
              expenses={expenses.items}
              isSavingView={isSavingView}
              onChangeView={onChangeView}
              view={view}
            />
          )}
        </Projection>
      );
    case "reminders":
      return (
        <Projection
          eventId={eventId}
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
              isSavingView={isSavingView}
              onChangeView={onChangeView}
              reminders={reminders.items}
              view={view}
            />
          )}
        </Projection>
      );
    case "files":
      return (
        <Projection
          eventId={eventId}
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
    case "people":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.people(eventId)}
          load={(signal) => client.withSignal(signal).getEventPeople(eventId)}
        >
          {(people) => (
            <PeoplePanel
              canEdit={canEdit}
              eventId={eventId}
              persons={people.items}
            />
          )}
        </Projection>
      );
  }
}

"use client";

import type {
  EventComponentKind,
  EventComponentView,
  NoteListQuery,
} from "@chronelle/schemas";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { tr } from "../../i18n/active-locale";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import { componentKindLabel, viewOf } from "../../lib/event-components";
import { queryKeys, useEventWorkspaceQueries } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { DocumentsPanel } from "./documents-panel";
import { ItineraryPanel } from "./itinerary-panel";
import { NotesPanel } from "./notes-panel";
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
  // The Notes order is a reading choice, kept while the component is open.
  const [noteSort, setNoteSort] = useState<NoteListQuery["sort"]>("edited");
  const kind = storedKind;
  const view = viewOf({ kind, view: storedView });
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
              sections={tasks.sections}
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
          {(timeline) => (
            <TimelinePanel
              canEdit={canEdit}
              eventId={eventId}
              timeline={timeline}
            />
          )}
        </Projection>
      );
    case "itinerary":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.itinerary(eventId)}
          load={(signal) =>
            client.withSignal(signal).getEventItinerary(eventId)
          }
        >
          {(itinerary) => (
            <Projection
              eventId={eventId}
              label={label}
              queryKey={queryKeys.todos(eventId)}
              load={(signal) =>
                client.withSignal(signal).getEventTodos(eventId)
              }
            >
              {(todos) => (
                <ItineraryComponent
                  canEdit={canEdit}
                  eventId={eventId}
                  isSavingView={isSavingView}
                  items={itinerary.items}
                  onChangeView={onChangeView}
                  tasks={todos.items}
                  view={view}
                />
              )}
            </Projection>
          )}
        </Projection>
      );
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
              sections={expenses.sections}
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
    case "notes":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.notes(eventId, noteSort)}
          load={(signal) =>
            client.withSignal(signal).getEventNotes(eventId, { sort: noteSort })
          }
        >
          {(page) => (
            <NotesPanel
              canEdit={canEdit}
              eventId={eventId}
              notes={page.items}
              onChangeSort={setNoteSort}
              sort={noteSort}
            />
          )}
        </Projection>
      );
  }
}

/** The day sheet needs the event's own dates for the days it turns. */
function ItineraryComponent(
  props: Omit<Parameters<typeof ItineraryPanel>[0], "event">,
) {
  const { event } = useEventWorkspaceQueries(props.eventId, null);
  return (
    <ItineraryPanel
      {...props}
      event={
        event.data ?? {
          startsOn: null,
          endsOn: null,
          startsAt: null,
          endsAt: null,
        }
      }
    />
  );
}

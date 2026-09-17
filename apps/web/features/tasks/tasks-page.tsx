"use client";

import {
  type EventComponentView,
  eventComponentViewSchema,
  type TaskListQuery,
  type TaskResponse,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { PlusIcon, SearchIcon } from "../../components/icons";
import { useQuickAddSlots } from "../../components/quick-add-row";
import { LayoutControl } from "../events/component-frame";
import { type SubtaskParent, TaskForm } from "../events/task-form";
import { TaskInspector } from "../events/task-inspector";
import { viewsOf } from "../../lib/event-components";
import { periodRange, usePeriod } from "../../lib/use-period";
import { shownTimeZone } from "../../i18n/active-preferences";
import {
  useLabelsQuery,
  usePersonsQuery,
  useRefreshEvent,
  useSessionQuery,
  useTasksQuery,
} from "../../lib/queries";
import { ManageLabelsButton } from "./label-manager";
import { QuickAddTask } from "./quick-add-task";
import {
  defaultTaskFilters,
  type TaskFilters,
  TaskFilterControl,
  TaskSortControl,
} from "./task-controls";
import { TaskListView } from "./task-list-view";

const viewStorageKey = "chronelle.task-view";

/**
 * Every task the user may view in the workspace, on its own or inside an
 * Event, as a list or by day, in manual order unless another sort is
 * chosen. The view is a device preference like the Event collection's
 * layout; the filter, sort, and query live with the tab.
 */
export function TasksPage() {
  const t = useTranslations("tasksPage");
  const controls = useTranslations("controls");
  const todos = useTranslations("todos");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>(defaultTaskFilters);
  const [sort, setSort] =
    useState<NonNullable<TaskListQuery["sort"]>>("manual");
  const [view, setView] = useState<EventComponentView>("list");
  const { status: filter, label, assignee } = filters;
  const [isAdding, setIsAdding] = useState(false);
  const [parent, setParent] = useState<SubtaskParent | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  useEffect(() => {
    try {
      const stored = eventComponentViewSchema.safeParse(
        window.localStorage.getItem(viewStorageKey),
      );
      if (stored.success && viewsOf("todos").includes(stored.data))
        setView(stored.data);
    } catch {
      // The list stays usable when browser storage is unavailable.
    }
  }, []);
  // A week or month asks the server for its days and loads all of them.
  const period = usePeriod(view);
  const range = useMemo(
    () => periodRange(view, period.cursor),
    [view, period.cursor],
  );
  const tasks = useTasksQuery({
    query: debouncedQuery,
    filter,
    sort,
    ...(label === "" ? {} : { label }),
    ...(assignee === "" ? {} : { assignee }),
    ...(range === null
      ? {}
      : {
          dueFrom: range.from,
          dueTo: range.to,
          timezone: shownTimeZone(),
          limit: 50,
        }),
  });
  const { fetchNextPage, hasNextPage, isFetching: isFetchingTasks } = tasks;
  useEffect(() => {
    if (range !== null && hasNextPage && !isFetchingTasks) void fetchNextPage();
  }, [range, hasNextPage, isFetchingTasks, fetchNextPage]);
  const labels = useLabelsQuery();
  const persons = usePersonsQuery();
  const session = useSessionQuery();
  // The person linked to the signed-in account, when one exists.
  const myPerson = persons.data?.items.find(
    (person) =>
      session.data !== undefined && person.userId === session.data.user.id,
  );
  const refresh = useRefreshEvent(undefined);
  const quickAdd = useQuickAddSlots();
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const items = changingQuery ? [] : (tasks.data?.items ?? []);
  const filtered =
    debouncedQuery !== "" ||
    filter !== "open" ||
    label !== "" ||
    assignee !== "";
  const labelChoices = labels.data?.items ?? [];
  const assigneeChoices = (persons.data?.items ?? [])
    .filter((person) => person.id !== myPerson?.id)
    .map((person) => ({ id: person.id, name: person.displayName }));

  // Stable, so the row cells keep their identity and focus across renders.
  const addSubtask = useCallback(
    (task: TaskResponse) =>
      setParent({
        id: task.id,
        displayName: task.displayName,
        permissionScopeId: task.permissionScopeId,
      }),
    [],
  );

  function changeView(next: EventComponentView) {
    setView(next);
    try {
      window.localStorage.setItem(viewStorageKey, next);
    } catch {
      // A preference that cannot be stored still applies to this page.
    }
  }

  return (
    <main className="workspace-page" tabIndex={-1}>
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        <button
          aria-haspopup="dialog"
          className="button button-primary"
          onClick={(event) => {
            event.currentTarget.focus();
            setIsAdding(true);
          }}
          type="button"
        >
          <PlusIcon />
          {t("new")}
        </button>
      </header>

      {isAdding ? (
        <TaskForm key="new" onCancel={() => setIsAdding(false)} />
      ) : null}
      {parent !== null ? (
        <TaskForm
          key={`sub:${parent.id}`}
          onCancel={() => setParent(null)}
          parent={parent}
        />
      ) : null}

      <section
        aria-labelledby="task-list-heading"
        className="event-list-section"
      >
        <div className="collection-toolbar">
          <label className="collection-search">
            <SearchIcon />
            <span className="visually-hidden">{t("filterByName")}</span>
            <input
              maxLength={240}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setIsComposing(false);
              }}
              onCompositionStart={() => setIsComposing(true)}
              placeholder={t("find")}
              type="search"
              value={query}
            />
          </label>
          <div className="head-controls">
            <TaskSortControl onChange={setSort} sort={sort} />
            <TaskFilterControl
              assignees={assigneeChoices}
              filters={filters}
              labels={labelChoices}
              me={myPerson}
              onChange={setFilters}
            />
            <LayoutControl
              onChange={changeView}
              view={view}
              views={viewsOf("todos")}
            />
          </div>
          <ManageLabelsButton />
          <button
            className="button button-quiet"
            disabled={tasks.isFetching || changingQuery}
            onClick={() => void tasks.refresh()}
            type="button"
          >
            {t("refresh")}
          </button>
        </div>
        <div className="collection-heading">
          <p
            aria-label={t("countLabel")}
            className="collection-count"
            role="status"
          >
            {tasks.data && !changingQuery
              ? t("count", { count: items.length })
              : ""}
          </p>
        </div>
        <div className="visually-hidden">
          <h2 id="task-list-heading">{t("all")}</h2>
        </div>
        {tasks.isPending || changingQuery ? (
          <LoadingState label={t("loading")} />
        ) : null}
        {tasks.isError ? (
          <ErrorNotice
            error={tasks.error}
            onRefresh={() =>
              void (tasks.isFetchNextPageError
                ? tasks.fetchNextPage()
                : tasks.refresh())
            }
          />
        ) : null}
        {!changingQuery &&
        !tasks.isError &&
        range === null &&
        tasks.data?.items.length === 0 &&
        !filtered ? (
          <>
            <EmptyState
              description={t("emptyDescription")}
              title={t("emptyTitle")}
            />
            <div className="quick-add-item quick-add-empty">
              <QuickAddTask
                dayLabel={
                  view === "by-day" ? todos("noDueDateGroup") : undefined
                }
                dueOn={null}
                slots={quickAdd}
              />
            </div>
          </>
        ) : null}
        {!changingQuery &&
        !tasks.isError &&
        range === null &&
        tasks.data &&
        items.length === 0 &&
        filtered ? (
          <div className="collection-empty">
            <EmptyState
              description={t("noMatchDescription")}
              title={t("noMatchTitle")}
            />
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setFilters(defaultTaskFilters);
              }}
              type="button"
            >
              {controls("clearFilters")}
            </button>
            <div className="quick-add-item quick-add-empty">
              <QuickAddTask
                dayLabel={
                  view === "by-day" ? todos("noDueDateGroup") : undefined
                }
                dueOn={null}
                slots={quickAdd}
              />
            </div>
          </div>
        ) : null}
        {items.length > 0 ||
        (range !== null && tasks.data !== undefined && !changingQuery) ? (
          <TaskListView
            canEdit
            contexts={tasks.data?.contexts}
            labelNames={labels.data?.names}
            manual={sort === "manual"}
            onAddSubtask={addSubtask}
            personNames={persons.data?.names}
            onEdit={setEditingId}
            onRefresh={refresh}
            parents={tasks.data?.parents ?? {}}
            period={period}
            progress={tasks.data?.progress ?? {}}
            quickAdd={quickAdd}
            tasks={items}
            view={view}
          />
        ) : null}
        {!changingQuery && range === null && tasks.hasNextPage ? (
          <button
            className="button button-secondary"
            disabled={tasks.isFetching}
            onClick={() => void tasks.fetchNextPage()}
            type="button"
          >
            {tasks.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </button>
        ) : null}
      </section>
      {editingId ? (
        <TaskInspector
          key={editingId}
          taskId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </main>
  );
}

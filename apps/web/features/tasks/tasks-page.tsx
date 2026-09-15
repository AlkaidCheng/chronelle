"use client";

import type { EventComponentView, TaskListQuery } from "@chronelle/schemas";
import { useEffect, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { PlusIcon, SearchIcon } from "../../components/icons";
import { ViewSwitch } from "../events/component-frame";
import { TaskForm } from "../events/task-form";
import { TaskInspector } from "../events/task-inspector";
import { viewsOf } from "../../lib/event-components";
import { useRefreshEvent, useTasksQuery } from "../../lib/queries";
import { TaskListView } from "./task-list-view";

const viewStorageKey = "chronelle.task-view";

/**
 * Every task the user may view in the workspace, on its own or inside an
 * Event, as a list or by day. The view is a device preference like the
 * Event collection's layout; the filter, sort, and query live with the tab.
 */
export function TasksPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [filter, setFilter] = useState<TaskListQuery["filter"]>("open");
  const [sort, setSort] = useState<TaskListQuery["sort"]>("due");
  const [view, setView] = useState<EventComponentView>("list");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(viewStorageKey) === "by-day")
        setView("by-day");
    } catch {
      // The list stays usable when browser storage is unavailable.
    }
  }, []);
  const tasks = useTasksQuery({ query: debouncedQuery, filter, sort });
  const refresh = useRefreshEvent(undefined);
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const items = changingQuery ? [] : (tasks.data?.items ?? []);
  const filtered = debouncedQuery !== "" || filter !== "open";

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
          <p className="eyebrow">What needs doing</p>
          <h1>Tasks</h1>
          <p>
            Every task you can see, on its own or inside an event, in due order.
          </p>
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
          New task
        </button>
      </header>

      {isAdding ? (
        <TaskForm key="new" onCancel={() => setIsAdding(false)} />
      ) : null}

      <section
        aria-labelledby="task-list-heading"
        className="event-list-section"
      >
        <div className="collection-toolbar">
          <label className="collection-search">
            <SearchIcon />
            <span className="visually-hidden">Filter tasks by name</span>
            <input
              maxLength={240}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setIsComposing(false);
              }}
              onCompositionStart={() => setIsComposing(true)}
              placeholder="Find a task..."
              type="search"
              value={query}
            />
          </label>
          <label className="compact-field collection-sort">
            <span className="visually-hidden">Sort tasks</span>
            <select
              onChange={(event) =>
                setSort(event.target.value as TaskListQuery["sort"])
              }
              value={sort}
            >
              <option value="due">Due date</option>
              <option value="updated">Recently updated</option>
              <option value="name">Name A-Z</option>
            </select>
          </label>
          <ViewSwitch
            onChange={changeView}
            view={view}
            views={viewsOf("todos")}
          />
          <button
            className="button button-quiet"
            disabled={tasks.isFetching || changingQuery}
            onClick={() => void tasks.refresh()}
            type="button"
          >
            Refresh tasks
          </button>
        </div>
        <div className="collection-heading">
          <fieldset aria-label="Filter tasks" className="filter-row">
            {(["open", "all", "done"] as const).map((value) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
                key={value}
                onClick={() => setFilter(value)}
                type="button"
              >
                {value === "open"
                  ? "Open tasks"
                  : value === "all"
                    ? "All tasks"
                    : "Completed"}
              </button>
            ))}
          </fieldset>
          <p aria-label="Task count" className="collection-count" role="status">
            {tasks.data && !changingQuery
              ? `${items.length} ${items.length === 1 ? "task" : "tasks"} loaded`
              : ""}
          </p>
        </div>
        <div className="visually-hidden">
          <h2 id="task-list-heading">All tasks</h2>
        </div>
        {tasks.isPending || changingQuery ? (
          <LoadingState label="Loading tasks" />
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
        tasks.data?.items.length === 0 &&
        !filtered ? (
          <EmptyState
            description="Choose New task for something to do on its own, or add tasks inside an event and find them here too."
            title="Nothing to do yet"
          />
        ) : null}
        {!changingQuery &&
        !tasks.isError &&
        tasks.data &&
        items.length === 0 &&
        filtered ? (
          <div className="collection-empty">
            <EmptyState
              description="Try another name or change your filters."
              title="No matching tasks"
            />
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setFilter("open");
              }}
              type="button"
            >
              Clear filters
            </button>
          </div>
        ) : null}
        {items.length > 0 ? (
          <TaskListView
            canEdit
            contexts={tasks.data?.contexts}
            onEdit={setEditingId}
            onRefresh={refresh}
            tasks={items}
            view={view}
          />
        ) : null}
        {!changingQuery && tasks.hasNextPage ? (
          <button
            className="button button-secondary"
            disabled={tasks.isFetching}
            onClick={() => void tasks.fetchNextPage()}
            type="button"
          >
            {tasks.isFetchingNextPage
              ? "Loading more tasks..."
              : "Load more tasks"}
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

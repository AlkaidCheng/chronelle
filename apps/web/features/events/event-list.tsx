"use client";

import type { EventResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type MouseEventHandler, useEffect, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { IconButton } from "../../components/icon-button";
import {
  ArrowIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SortIcon,
} from "../../components/icons";
import { MenuItem, QuietMenu } from "../../components/quiet-menu";
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
  const t = useTranslations("events");
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
          {t(`period.${eventPeriod(event, now)}`)}
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
  const t = useTranslations("events");
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
  const filters = ["all", "upcoming", "unscheduled", "past"] as const;
  const sorts = ["date", "updated", "name"] as const;
  return (
    <main className="workspace-page" ref={container} tabIndex={-1}>
      <header className="quiet-heading collection-column">
        <h1>{t("title")}</h1>
        <div className="quiet-tools">
          <label className="inline-search">
            <SearchIcon />
            <span className="visually-hidden">{t("filterByName")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => change({ query: event.target.value })}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                change({ query: event.currentTarget.value });
                setIsComposing(false);
              }}
              placeholder={t("find")}
              maxLength={240}
            />
          </label>
          <QuietMenu
            label={t("filterMenu")}
            icon={<FilterIcon />}
            active={filter !== "all"}
            value={filter}
          >
            {filters.map((value) => (
              <MenuItem
                key={value}
                checked={filter === value}
                onSelect={() => change({ filter: value })}
              >
                {t(`filters.${value}`)}
              </MenuItem>
            ))}
          </QuietMenu>
          <QuietMenu label={t("sortMenu")} icon={<SortIcon />} value={sort}>
            {sorts.map((value) => (
              <MenuItem
                key={value}
                checked={sort === value}
                onSelect={() => change({ sort: value })}
              >
                {t(`sorts.${value}`)}
              </MenuItem>
            ))}
          </QuietMenu>
          <QuietMenu
            label={t("layoutMenu")}
            icon={layout === "grid" ? <GridIcon /> : <ListIcon />}
            value={layout}
          >
            <MenuItem
              checked={layout === "grid"}
              icon={<GridIcon />}
              onSelect={() => changeLayout("grid")}
            >
              {t("layouts.grid")}
            </MenuItem>
            <MenuItem
              checked={layout === "list"}
              icon={<ListIcon />}
              onSelect={() => changeLayout("list")}
            >
              {t("layouts.list")}
            </MenuItem>
          </QuietMenu>
          <IconButton
            label={t("refresh")}
            disabled={events.isFetching || changingQuery}
            onClick={() => {
              change({});
              void events.refresh();
            }}
          >
            <RefreshIcon />
          </IconButton>
          <IconButton
            label={t("new")}
            tone="primary"
            aria-haspopup="dialog"
            onClick={(event) => {
              event.currentTarget.focus();
              setIsCreating(true);
            }}
          >
            <PlusIcon />
          </IconButton>
        </div>
      </header>

      {isCreating ? (
        <CreateEventDialog
          onClose={() => setIsCreating(false)}
          onCreated={(id) => router.push(`/events/${id}`)}
        />
      ) : null}

      <section
        aria-labelledby="event-list-heading"
        className="event-list-section collection-column"
      >
        <p
          aria-label={t("countLabel")}
          className="visually-hidden"
          role="status"
        >
          {events.data && !changingQuery
            ? t("count", { count: items.length })
            : ""}
        </p>
        <div className="visually-hidden">
          <h2 id="event-list-heading">{t("all")}</h2>
        </div>
        {events.isPending || changingQuery ? (
          <LoadingState label={t("loading")} />
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
          <EmptyState title={t("empty")} />
        ) : null}
        {!changingQuery &&
        !events.isError &&
        events.data &&
        items.length === 0 &&
        filtered ? (
          <div className="collection-empty">
            <EmptyState title={t("noMatch")} />
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                change({ query: "", filter: "all" });
              }}
            >
              {t("clearFilters")}
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
            {events.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </button>
        ) : null}
      </section>
    </main>
  );
}

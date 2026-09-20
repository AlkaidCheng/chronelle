"use client";

import type { EventListItem } from "@chronelle/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type MouseEventHandler,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { IconButton } from "../../components/icon-button";
import {
  FilterIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  ShareIcon,
  SortIcon,
} from "../../components/icons";
import { MenuItem, QuietMenu } from "../../components/quiet-menu";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import { eventPeriod } from "../../lib/event-collection";
import {
  useEventCollectionReturn,
  useEventCollectionState,
} from "../../lib/event-collection-state";
import {
  formatEventDatePart,
  formatEventSchedule,
} from "../../lib/event-schedule";
import { useEventAccessQuery, useEventsQuery } from "../../lib/queries";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { CreateEventDialog } from "./create-event-dialog";
import { EventInspector } from "./event-inspector";
import { ShareSheet } from "./share-sheet";

/**
 * The card's controls at its right edge: Share, opening the sheet that
 * shares the whole Event, and the row menu (Edit event, History, Share,
 * Move to Trash). They sit beside the card's link, not inside it. The
 * Event's access is read once the card is hovered or focused, so the
 * menu offers only what the account may do; Share shows until the
 * access says otherwise.
 */
function EventCardActions({
  armed,
  event,
}: {
  readonly armed: boolean;
  readonly event: EventListItem;
}) {
  const t = useTranslations("events");
  const share = useTranslations("share");
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();
  const access = useEventAccessQuery(armed ? event.id : undefined);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const closeSheet = useCallback((byKeyboard: boolean) => {
    setSharing(false);
    if (byKeyboard) shareButton.current?.focus();
  }, []);
  const actions = access.data?.actions;
  const may = (action: "edit" | "share" | "delete") =>
    actions?.includes(action) ?? false;
  const canShare = actions === undefined || may("share");
  const entries: RowMenuEntry[] = [];
  if (may("edit"))
    entries.push({
      kind: "action",
      label: t("menu.edit"),
      onSelect: () => setEditing(true),
    });
  entries.push({
    kind: "action",
    label: t("menu.history"),
    onSelect: () =>
      openHistory({ objectId: event.id, displayName: event.displayName }),
  });
  if (canShare)
    entries.push({
      kind: "action",
      label: t("menu.share"),
      onSelect: () => setSharing(true),
    });
  if (may("delete"))
    entries.push(
      { kind: "rule" },
      {
        kind: "action",
        label: t("menu.moveToTrash"),
        danger: true,
        onSelect: () => openLifecycle(event),
      },
    );
  return (
    <>
      <div className="event-card-actions">
        {canShare ? (
          <div className="event-card-share">
            <IconButton
              aria-expanded={sharing}
              aria-haspopup="dialog"
              label={t("menu.share")}
              onClick={() => setSharing((current) => !current)}
              ref={shareButton}
            >
              <ShareIcon />
            </IconButton>
            {sharing ? (
              <ShareSheet
                eventId={event.id}
                hint={share("eventHint")}
                name={event.displayName}
                onClose={closeSheet}
                scope={null}
              />
            ) : null}
          </div>
        ) : null}
        <RowMenu
          entries={entries}
          label={t("actionsFor", { name: event.displayName })}
        />
      </div>
      {editing ? (
        <EventInspector event={event} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}

/**
 * The card's third line: who shared the event and the role held, for an
 * event shared with the account; how many accounts it is shared with, for
 * the account's own; empty otherwise, so every card keeps its height.
 */
function EventShareLine({ event }: { readonly event: EventListItem }) {
  const t = useTranslations("events");
  const roles = useTranslations("members.roles");
  const { sharedBy, role, sharedWith } = event.access;
  if (sharedBy !== null) {
    return (
      <p className="event-card-share-line">
        <span className="event-shared-by">
          <ShareIcon />
          {t("sharedBy", { name: sharedBy.displayName })}
        </span>
        {role === null ? null : (
          <span className="event-shared-role">{roles(role)}</span>
        )}
      </p>
    );
  }
  if (sharedWith > 0) {
    return (
      <p className="event-card-share-line">
        <span className="event-shared-with">
          <ShareIcon />
          {t("sharedWith", { count: sharedWith })}
        </span>
      </p>
    );
  }
  return <p className="event-card-share-line" />;
}

/**
 * One compact object: the date tile, the name, the dates, and a third
 * line for sharing; the whole card is the link. A past or undated event
 * reads muted in its tile. A shared card opens its event page directly:
 * the API reads the workspace from the event.
 */
function EventCard({
  event,
  now,
  onOpen,
}: {
  readonly event: EventListItem;
  readonly now: number;
  readonly onOpen: MouseEventHandler<HTMLAnchorElement>;
}) {
  const t = useTranslations("events");
  const dates = useTranslations("dates");
  const [armed, setArmed] = useState(false);
  const period = eventPeriod(event, now);
  const arm = () => setArmed(true);
  return (
    <article
      className={`event-card-shell period-${period}${
        event.access.sharedBy === null ? "" : " event-card-shared"
      }`}
      onFocus={arm}
      onPointerEnter={arm}
    >
      <Link
        className="event-card"
        data-event-id={event.id}
        href={`/events/${event.id}`}
        onClick={onOpen}
      >
        <div className="event-date-mark">
          {period === "unscheduled" ? (
            <strong className="event-date-tbd">{dates("tbd")}</strong>
          ) : (
            <>
              <span>{formatEventDatePart(event, "month").toUpperCase()}</span>
              <strong>{formatEventDatePart(event, "day")}</strong>
            </>
          )}
        </div>
        <div className="event-card-copy">
          <h2>{event.displayName}</h2>
          <p>
            {period === "unscheduled"
              ? t("undated")
              : formatEventSchedule(event)}
          </p>
          <EventShareLine event={event} />
        </div>
      </Link>
      <EventCardActions armed={armed} event={event} />
    </article>
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
      <header className="quiet-heading events-heading events-column">
        <h1>{t("title")}</h1>
        <label className="inline-search events-search">
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
        <div className="quiet-tools">
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
        className={`event-list-section ${
          layout === "list" ? "collection-column" : "events-column"
        }`}
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

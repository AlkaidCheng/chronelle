"use client";

import type { EventResponse, TaskResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useRef, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { IconButton } from "../../components/icon-button";
import {
  CalendarIcon,
  ChevronLeftIcon,
  LinkIcon,
  MoreIcon,
  PencilIcon,
  TrashIcon,
} from "../../components/icons";
import {
  MenuItem,
  MenuSeparator,
  QuietMenu,
} from "../../components/quiet-menu";
import { formatEventSchedule } from "../../lib/event-schedule";
import { personAccount } from "../../lib/person-collection";
import { personDisplayName, propertyText } from "../../lib/person-fields";
import {
  usePersonEditorQueries,
  usePersonEventsQuery,
  useSessionQuery,
  useTasksQuery,
  useLabelsQuery,
} from "../../lib/queries";
import { formatTaskWhen } from "../../lib/task-due";
import { StatusChip } from "../events/component-frame";
import { HistoryButton } from "../history/history-button";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { PersonInspector } from "./person-inspector";
import {
  PersonAvatar,
  PersonBadge,
  PersonContacts,
  PersonLabels,
} from "./person-row";

type PersonTab = "overview" | "events" | "tasks";

const personTabs: readonly PersonTab[] = ["overview", "events", "tasks"];

/**
 * One person's page: the nickname as the title with the full name, the
 * account badge and the labels under it; Edit, History, and More (Copy
 * link, Move to Trash); then Overview (the details and the description),
 * the Events the person is part of, and the Tasks assigned to them.
 */
export function PersonPage({ personId }: { readonly personId: string }) {
  const t = useTranslations("personPage");
  const people = useTranslations("people");
  const { person, access } = usePersonEditorQueries(personId);
  const session = useSessionQuery();
  const labelNames = useLabelsQuery().data?.names;
  const openLifecycle = useOpenLifecycle();
  const [tab, setTab] = useState<PersonTab>("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState("");
  const tabs = useRef(new Map<PersonTab, HTMLButtonElement>());

  if (person.isPending)
    return (
      <main className="workspace-page" tabIndex={-1}>
        <LoadingState label={t("loading")} />
      </main>
    );
  if (person.isError || person.data === undefined)
    return (
      <main className="workspace-page" tabIndex={-1}>
        <Link className="up-link" aria-label={t("allPeople")} href="/people">
          <ChevronLeftIcon />
          {people("title")}
        </Link>
        <ErrorNotice
          error={person.error}
          onRefresh={() => void person.refetch()}
        />
      </main>
    );
  const record = person.data;
  const name = personDisplayName(record);
  const actions = access.data?.actions ?? [];
  const canEdit = actions.includes("edit");
  const canDelete = actions.includes("delete");
  const account = personAccount(record, session.data?.user.id);
  const fields = Object.entries(record.customProperties);

  function copyLink() {
    const link = `${window.location.origin}/people/${record.id}`;
    navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(t("linkCopied")))
      .catch(() => setCopied(t("linkNotCopied")));
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = personTabs.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? personTabs[(at + 1) % personTabs.length]
        : event.key === "ArrowLeft"
          ? personTabs[(at - 1 + personTabs.length) % personTabs.length]
          : event.key === "Home"
            ? personTabs[0]
            : event.key === "End"
              ? personTabs[personTabs.length - 1]
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setTab(next);
    tabs.current.get(next)?.focus();
  }

  return (
    <main className="workspace-page person-page" tabIndex={-1}>
      <header className="event-hero">
        <Link className="up-link" aria-label={t("allPeople")} href="/people">
          <ChevronLeftIcon />
          {people("title")}
        </Link>
        <div className="event-title-row person-title-row">
          <PersonAvatar name={name} size="page" />
          <div className="person-titles">
            <h1>{name}</h1>
            <p className="person-subline">
              {record.nickname !== null ? (
                <span className="person-fullname">{record.displayName}</span>
              ) : null}
              <PersonBadge account={account} />
              <PersonLabels labelNames={labelNames} person={record} />
            </p>
          </div>
          <div className="event-actions">
            {canEdit ? (
              <IconButton label={t("edit")} onClick={() => setIsEditing(true)}>
                <PencilIcon />
              </IconButton>
            ) : null}
            <HistoryButton
              displayName={name}
              objectId={record.id}
              variant="icon"
            />
            <QuietMenu
              icon={<MoreIcon />}
              label={people("actionsFor", { name })}
            >
              <MenuItem icon={<LinkIcon />} onSelect={copyLink}>
                {t("copyLink")}
              </MenuItem>
              {canDelete ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<TrashIcon />}
                    onSelect={() => openLifecycle(record)}
                    tone="danger"
                  >
                    {people("menu.moveToTrash")}
                  </MenuItem>
                </>
              ) : null}
            </QuietMenu>
          </div>
        </div>
        <p className="visually-hidden" role="status">
          {copied}
        </p>
      </header>

      <div aria-label={t("sections")} className="tab-list" role="tablist">
        {personTabs.map((choice) => (
          <button
            aria-controls={`person-panel-${choice}`}
            aria-selected={tab === choice}
            className={tab === choice ? "active" : ""}
            id={`person-tab-${choice}`}
            key={choice}
            onClick={() => setTab(choice)}
            onKeyDown={onTabKeyDown}
            ref={(element) => {
              if (element === null) tabs.current.delete(choice);
              else tabs.current.set(choice, element);
            }}
            role="tab"
            tabIndex={tab === choice ? 0 : -1}
            type="button"
          >
            {t(`tabs.${choice}`)}
          </button>
        ))}
      </div>
      <section
        aria-labelledby={`person-tab-${tab}`}
        className="person-panel"
        id={`person-panel-${tab}`}
        role="tabpanel"
      >
        {tab === "overview" ? (
          <div className="person-overview">
            <section className="planning-panel">
              <header className="panel-heading">
                <div>
                  <h2>{t("details")}</h2>
                </div>
              </header>
              <dl className="person-details">
                {record.nickname !== null ? (
                  <div>
                    <dt>{t("fullName")}</dt>
                    <dd>{record.displayName}</dd>
                  </div>
                ) : null}
                {record.contacts.length > 0 ? (
                  <div>
                    <dt>{t("contacts")}</dt>
                    <dd>
                      <PersonContacts person={record} withIcons />
                    </dd>
                  </div>
                ) : null}
                {fields.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{propertyText(value)}</dd>
                  </div>
                ))}
              </dl>
              {record.contacts.length === 0 && fields.length === 0 ? (
                <p className="muted">{t("noDetails")}</p>
              ) : null}
            </section>
            <section className="planning-panel">
              <header className="panel-heading">
                <div>
                  <h2>{t("description")}</h2>
                </div>
              </header>
              {record.description === null ? (
                <p className="muted">{t("noDescription")}</p>
              ) : (
                <p className="person-description">{record.description}</p>
              )}
            </section>
          </div>
        ) : tab === "events" ? (
          <PersonEvents personId={record.id} />
        ) : (
          <PersonTasks personId={record.id} />
        )}
      </section>
      {isEditing ? (
        <PersonInspector
          key={record.id}
          onClose={() => setIsEditing(false)}
          personId={record.id}
        />
      ) : null}
    </main>
  );
}

/** The Events the person is part of, each a link to its page with its dates. */
function PersonEvents({ personId }: { readonly personId: string }) {
  const t = useTranslations("personPage");
  const events = usePersonEventsQuery(personId);
  if (events.isPending) return <LoadingState label={t("loadingEvents")} />;
  if (events.isError)
    return (
      <ErrorNotice
        error={events.error}
        onRefresh={() => void events.refetch()}
      />
    );
  if (events.data.items.length === 0)
    return <EmptyState title={t("noEvents")} />;
  return (
    <ul aria-label={t("tabs.events")} className="resource-list">
      {events.data.items.map((event: EventResponse) => {
        const schedule = formatEventSchedule(event);
        return (
          <li key={event.id}>
            <div className="resource-copy">
              <strong>
                <Link href={`/events/${event.id}`}>{event.displayName}</Link>
              </strong>
              {schedule === "" ? null : (
                <p className="event-date">
                  <CalendarIcon />
                  {schedule}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The tasks assigned to the person, open and done, each a link to where it lives. */
function PersonTasks({ personId }: { readonly personId: string }) {
  const t = useTranslations("personPage");
  const tasks = useTasksQuery({
    query: "",
    filter: "all",
    sort: "due",
    assignee: personId,
  });
  if (tasks.isPending) return <LoadingState label={t("loadingTasks")} />;
  if (tasks.isError)
    return (
      <ErrorNotice error={tasks.error} onRefresh={() => tasks.refresh()} />
    );
  const items = tasks.data?.items ?? [];
  if (items.length === 0) return <EmptyState title={t("noTasks")} />;
  return (
    <>
      <ul aria-label={t("tabs.tasks")} className="resource-list">
        {items.map((task: TaskResponse) => {
          const context = tasks.data?.contexts?.[task.id];
          const href =
            context === undefined
              ? `/tasks#task-${task.id}`
              : `/events/${context.eventId}#task-${task.id}`;
          const when = formatTaskWhen(task, true);
          return (
            <li
              className={task.status === "done" ? "is-done" : undefined}
              key={task.id}
            >
              <div className="resource-copy">
                <strong>
                  <Link href={href}>{task.displayName}</Link>
                </strong>
                {when === "" ? null : <p>{when}</p>}
                {context === undefined ? null : (
                  <p className="muted">{context.displayName}</p>
                )}
              </div>
              <StatusChip status={task.status} />
            </li>
          );
        })}
      </ul>
      {tasks.hasNextPage ? (
        <button
          className="button button-secondary"
          disabled={tasks.isFetching}
          onClick={() => void tasks.fetchNextPage()}
          type="button"
        >
          {t("loadMoreTasks")}
        </button>
      ) : null}
    </>
  );
}

"use client";

import type { EventResponse, TaskResponse } from "@livtales/schemas";
import Link from "next/link";
import { AccessLine } from "../../components/access-line";
import { useTranslations } from "next-intl";
import { Fragment, type KeyboardEvent, useRef, useState } from "react";

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
  ShareIcon,
  TrashIcon,
} from "../../components/icons";
import {
  MenuItem,
  MenuSeparator,
  QuietMenu,
} from "../../components/quiet-menu";
import { UndoMenuItems } from "../../components/undo-menu-items";
import { usePageCommandHistory } from "../../lib/command-history";
import { formatEventSchedule } from "../../lib/event-schedule";
import { personAccount } from "../../lib/person-collection";
import { personDisplayName, propertyText } from "../../lib/person-fields";
import { useFriendsQuery } from "../../lib/friend-queries";
import {
  useLabelsQuery,
  usePersonEditorQueries,
  usePersonEventsQuery,
  useSessionQuery,
  useTasksQuery,
} from "../../lib/queries";
import { formatTaskWhen } from "../../lib/task-due";
import { usePersonConnections } from "../../lib/use-person-connections";
import { StatusChip } from "../events/component-frame";
import { InviteFriendDialog } from "../friends/invite-friend-dialog";
import { HistoryButton } from "../history/history-button";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { PersonConnection } from "./person-connection";
import { PersonInspector } from "./person-inspector";
import { PersonShared } from "./person-shared";
import { ShareWithPersonDialog } from "./share-with-person-dialog";
import { PersonAvatar, PersonBadge, PersonLabels } from "./person-row";

type PersonTab = "overview" | "shared" | "events" | "tasks";

const personTabs: readonly PersonTab[] = [
  "overview",
  "shared",
  "events",
  "tasks",
];

/**
 * One person's page: the nickname as the title with the full name, the
 * account badge and the labels under it; Edit, Share with the person,
 * History, and More (Copy link, Move to Trash); then Overview (the details
 * that exist, the description when there is one, the connection, and what
 * is shared each way), Shared in full, the Events the person is part of,
 * and the Tasks assigned to them.
 */
export function PersonPage({ personId }: { readonly personId: string }) {
  const t = useTranslations("personPage");
  const people = useTranslations("people");
  const contactKinds = useTranslations("person");
  const { person, access } = usePersonEditorQueries(personId);
  usePageCommandHistory(person.data);
  const session = useSessionQuery();
  const friends = useFriendsQuery();
  const connections = usePersonConnections();
  const labelNames = useLabelsQuery().data?.names;
  const openLifecycle = useOpenLifecycle();
  const [tab, setTab] = useState<PersonTab>("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
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
  const account = personAccount(record, session.data?.user.id, connections);
  // What is shared with the person, and sharing with them, belong to the
  // workspace's members; a card reached through a share has neither.
  const own = access.data?.source.kind === "own";
  const tabChoices = own
    ? personTabs
    : personTabs.filter((choice) => choice !== "shared");
  // A share by person reaches the linked account, else the one account
  // with the person's email; a friend's address stands for one here.
  const hasAccount =
    account === "friend" ||
    account === "linked" ||
    (friends.data?.friends ?? []).some((friend) =>
      record.contacts.some(
        (contact) =>
          contact.kind === "email" &&
          friend.email !== null &&
          contact.value.toLowerCase() === friend.email.toLowerCase(),
      ),
    );
  const fields = Object.entries(record.customProperties);
  const hasDetails =
    record.nickname !== null ||
    record.contacts.length > 0 ||
    fields.length > 0 ||
    record.labelIds.length > 0;

  function copyLink() {
    const link = `${window.location.origin}/people/${record.id}`;
    navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(t("linkCopied")))
      .catch(() => setCopied(t("linkNotCopied")));
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = tabChoices.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? tabChoices[(at + 1) % tabChoices.length]
        : event.key === "ArrowLeft"
          ? tabChoices[(at - 1 + tabChoices.length) % tabChoices.length]
          : event.key === "Home"
            ? tabChoices[0]
            : event.key === "End"
              ? tabChoices[tabChoices.length - 1]
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
          <PersonAvatar
            linked={record.userId !== null}
            name={name}
            size="page"
          />
          <div className="person-titles">
            <h1>{name}</h1>
            <p className="person-subline">
              {record.nickname !== null ? (
                <span className="person-fullname">{record.displayName}</span>
              ) : null}
              <PersonBadge account={account} />
              <PersonLabels labelNames={labelNames} person={record} />
            </p>
            <AccessLine source={access.data?.source} />
          </div>
          <div className="event-actions">
            {canEdit ? (
              <IconButton label={t("edit")} onClick={() => setIsEditing(true)}>
                <PencilIcon />
              </IconButton>
            ) : null}
            {own && account !== "me" ? (
              <IconButton
                label={t("shareWith", { name })}
                onClick={() => setIsSharing(true)}
              >
                <ShareIcon />
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
              {canEdit ? (
                <>
                  <UndoMenuItems />
                  <MenuSeparator />
                </>
              ) : null}
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
        {tabChoices.map((choice) => (
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
            <div className="person-overview-column">
              <section aria-labelledby="person-details" className="quiet-panel">
                <header className="quiet-panel-head">
                  <h2 id="person-details">{t("details")}</h2>
                </header>
                {hasDetails ? (
                  <dl className="kv-list">
                    {record.nickname !== null ? (
                      <>
                        <dt>{t("nickname")}</dt>
                        <dd>{record.nickname}</dd>
                      </>
                    ) : null}
                    {record.contacts.map((contact, index) => (
                      // Contacts have no identity of their own; their position is it.
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                      <Fragment key={index}>
                        <dt>{contactKinds(`contactKinds.${contact.kind}`)}</dt>
                        <dd>
                          {contact.kind === "email" ? (
                            <a href={`mailto:${contact.value}`}>
                              {contact.value}
                            </a>
                          ) : contact.kind === "phone" ? (
                            <a href={`tel:${contact.value}`}>{contact.value}</a>
                          ) : (
                            contact.value
                          )}
                        </dd>
                      </Fragment>
                    ))}
                    {fields.map(([key, value]) => (
                      <Fragment key={key}>
                        <dt>{key}</dt>
                        <dd>{propertyText(value)}</dd>
                      </Fragment>
                    ))}
                    {record.labelIds.length > 0 ? (
                      <>
                        <dt>{t("labels")}</dt>
                        <dd>
                          <PersonLabels
                            labelNames={labelNames}
                            person={record}
                          />
                        </dd>
                      </>
                    ) : null}
                  </dl>
                ) : (
                  <p className="kv-empty">{t("noDetails")}</p>
                )}
              </section>
              {record.description !== null ? (
                <section
                  aria-labelledby="person-description"
                  className="quiet-panel"
                >
                  <header className="quiet-panel-head">
                    <h2 id="person-description">{t("description")}</h2>
                  </header>
                  <p className="person-description">{record.description}</p>
                </section>
              ) : null}
            </div>
            <div className="person-overview-column">
              <PersonConnection
                account={account}
                canEdit={canEdit}
                onInvite={() => setIsInviting(true)}
                onLink={() => setIsEditing(true)}
                person={record}
              />
              {own ? (
                <PersonShared
                  onSeeAll={() => setTab("shared")}
                  personId={record.id}
                  personName={name}
                  variant="panel"
                />
              ) : null}
            </div>
          </div>
        ) : tab === "shared" ? (
          <PersonShared personId={record.id} personName={name} variant="tab" />
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
      {isInviting ? (
        <InviteFriendDialog
          onClose={() => setIsInviting(false)}
          personId={record.id}
        />
      ) : null}
      {isSharing ? (
        <ShareWithPersonDialog
          hasAccount={hasAccount}
          onClose={() => setIsSharing(false)}
          person={record}
          personName={name}
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

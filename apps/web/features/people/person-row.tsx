"use client";

import type { PersonResponse } from "@livtales/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  CheckIcon,
  ClockIcon,
  MailIcon,
  PhoneIcon,
  PlusIcon,
} from "../../components/icons";
import type { QuickAddSlots } from "../../components/quick-add-row";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import {
  type PersonConnections,
  type PersonLayout,
  personAccount,
  personInitials,
} from "../../lib/person-collection";
import { personDisplayName } from "../../lib/person-fields";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { QuickAddPerson, quickAddPersonSlot } from "./quick-add-person";

/** What the signed-in account knows about the account behind a person. */
export type PersonAccountState = "me" | "friend" | "linked" | "invited" | null;

/**
 * The letters that stand for a person, sized for a row, a card, or a
 * page; in the accent when the person stands for an account.
 */
export function PersonAvatar({
  linked = false,
  name,
  size = "row",
}: {
  readonly linked?: boolean;
  readonly name: string;
  readonly size?: "row" | "card" | "page";
}) {
  return (
    <span
      aria-hidden="true"
      className={`person-avatar person-avatar-${size}${linked ? " person-avatar-linked" : ""}`}
    >
      {personInitials(name)}
    </span>
  );
}

/** "This is me", "Friend", "Invited", "Has an account", or "No account". */
export function PersonBadge({
  account,
}: {
  readonly account: PersonAccountState;
}) {
  const t = useTranslations("people");
  const label =
    account === "me"
      ? t("me")
      : account === "friend"
        ? t("friend")
        : account === "invited"
          ? t("invited")
          : account === "linked"
            ? t("hasAccount")
            : t("accounts.unlinked");
  return (
    <span className={`person-badge person-badge-${account ?? "none"}`}>
      {account === "friend" ? <CheckIcon /> : null}
      {account === "invited" ? <ClockIcon /> : null}
      {label}
    </span>
  );
}

export function PersonLabels({
  labelNames,
  person,
}: {
  readonly labelNames?: ReadonlyMap<string, string> | undefined;
  readonly person: Pick<PersonResponse, "labelIds">;
}) {
  const t = useTranslations("person");
  const labels = person.labelIds.flatMap((id) => {
    const label = labelNames?.get(id);
    return label === undefined ? [] : [{ id, name: label }];
  });
  if (labels.length === 0) return null;
  return (
    <ul aria-label={t("labels")} className="person-labels">
      {labels.map((label) => (
        <li className="person-label" key={label.id}>
          {label.name}
        </li>
      ))}
    </ul>
  );
}

/** A person's contacts, each a line; an email and a phone are links. */
export function PersonContacts({
  person,
  withIcons = false,
}: {
  readonly person: Pick<PersonResponse, "contacts">;
  readonly withIcons?: boolean;
}) {
  const t = useTranslations("person");
  if (person.contacts.length === 0) return null;
  return (
    <ul aria-label={t("contacts")} className="person-contacts">
      {person.contacts.map((contact, index) => (
        // Contacts have no identity of their own; their position is it.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
        <li key={index}>
          {withIcons ? (
            contact.kind === "email" ? (
              <MailIcon className="person-contact-icon" />
            ) : contact.kind === "phone" ? (
              <PhoneIcon className="person-contact-icon" />
            ) : (
              <span className="person-contact-icon" />
            )
          ) : null}
          {contact.kind === "email" ? (
            <a className="person-email" href={`mailto:${contact.value}`}>
              {contact.value}
            </a>
          ) : contact.kind === "phone" ? (
            <a className="person-email" href={`tel:${contact.value}`}>
              {contact.value}
            </a>
          ) : (
            <span>{contact.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What a row or card needs to know beyond the person it shows. */
export interface PersonRowContext {
  readonly canEdit: boolean;
  /** The Event the row is shown in, when any; its actions then offer removal from it. */
  readonly eventId?: string | undefined;
  readonly labelNames?: ReadonlyMap<string, string> | undefined;
  /** The signed-in user's account id, to mark their own person. */
  readonly me: string | undefined;
  /** The signed-in account's friends and invited cards, for the badges. */
  readonly connections?: PersonConnections | undefined;
  readonly onEdit: (personId: string) => void;
}

/**
 * The menu behind a row's or card's More: Edit, History, then Move to
 * Trash (which, inside an Event, also offers removal from it).
 */
function usePersonMenu() {
  const t = useTranslations("people");
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();
  return (person: PersonResponse, context: PersonRowContext) => {
    const name = personDisplayName(person);
    const entries: RowMenuEntry[] = [];
    if (context.canEdit)
      entries.push({
        kind: "action",
        label: t("menu.edit"),
        onSelect: () => context.onEdit(person.id),
      });
    entries.push({
      kind: "action",
      label: t("menu.history"),
      onSelect: () => openHistory({ objectId: person.id, displayName: name }),
    });
    if (context.canEdit)
      entries.push(
        { kind: "rule" },
        {
          kind: "action",
          label: t("menu.moveToTrash"),
          danger: true,
          onSelect: () =>
            openLifecycle(
              context.eventId === undefined
                ? person
                : { ...person, eventId: context.eventId },
            ),
        },
      );
    return <RowMenu entries={entries} label={t("actionsFor", { name })} />;
  };
}

/**
 * One person as a row: the avatar, the nickname over the full name (or
 * the name alone) as the link to their page (stretched over the row, so a
 * press anywhere but on a control opens the person), the contacts, the
 * labels, the account badge, and the row menu. Every cell renders, so
 * the columns line up when a person has no contact or label.
 */
export function PersonRow({
  context,
  person,
}: {
  readonly context: PersonRowContext;
  readonly person: PersonResponse;
}) {
  const t = useTranslations("people");
  const menu = usePersonMenu();
  const name = personDisplayName(person);
  const account = personAccount(person, context.me, context.connections);
  return (
    <li aria-label={name} className="person-row" id={`person-${person.id}`}>
      <PersonAvatar linked={person.userId !== null} name={name} />
      <div className="person-names">
        <Link
          aria-label={t("open", { name })}
          className="person-name"
          href={`/people/${person.id}`}
        >
          {name}
        </Link>
        {person.nickname !== null ? (
          <span className="person-fullname">{person.displayName}</span>
        ) : null}
      </div>
      <div className="person-row-cell">
        <PersonContacts person={person} />
      </div>
      <div className="person-row-cell">
        <PersonLabels labelNames={context.labelNames} person={person} />
      </div>
      <span className="person-row-badge">
        <PersonBadge account={account} />
      </span>
      {menu(person, context)}
    </li>
  );
}

/**
 * One person as a namecard: the avatar, the names as the link to their
 * page, the contacts with icons, the description, then the badge and the
 * labels at the foot; the menu shows on hover or focus.
 */
export function PersonNamecard({
  context,
  person,
}: {
  readonly context: PersonRowContext;
  readonly person: PersonResponse;
}) {
  const t = useTranslations("people");
  const menu = usePersonMenu();
  const name = personDisplayName(person);
  const account = personAccount(person, context.me, context.connections);
  return (
    <li aria-label={name} className="person-card" id={`person-${person.id}`}>
      <div className="person-card-top">
        <PersonAvatar linked={person.userId !== null} name={name} size="card" />
        <div className="person-names">
          <Link
            aria-label={t("open", { name })}
            className="person-name"
            href={`/people/${person.id}`}
          >
            {name}
          </Link>
          {person.nickname !== null ? (
            <span className="person-fullname">{person.displayName}</span>
          ) : null}
        </div>
        {menu(person, context)}
      </div>
      <PersonContacts person={person} withIcons />
      {person.description !== null ? (
        <p className="person-description">{person.description}</p>
      ) : null}
      <div className="person-card-foot">
        <PersonBadge account={account} />
        <PersonLabels labelNames={context.labelNames} person={person} />
      </div>
    </li>
  );
}

/**
 * The people of a collection in the chosen layout, ending with the quick
 * add row when the collection takes one (and, among namecards, a card
 * that opens that row). The list is one card: its rows, what stands in
 * for them while there are none, then the add row.
 */
export function PersonListing({
  context,
  empty,
  items,
  label,
  layout,
  quickAdd,
}: {
  readonly context: PersonRowContext;
  /** What the list says while it has no rows: the title, and what to do about it. */
  readonly empty?: ReactNode;
  readonly items: readonly PersonResponse[];
  /** The accessible name of the list. */
  readonly label: string;
  readonly layout: PersonLayout;
  readonly quickAdd?: QuickAddSlots | undefined;
}) {
  const t = useTranslations("people");
  const adding = quickAdd !== undefined && context.canEdit;
  const emptyNote =
    items.length === 0 && empty !== undefined ? (
      <p className="person-empty">{empty}</p>
    ) : null;
  if (layout === "cards")
    return (
      <>
        {emptyNote}
        {items.length > 0 || adding ? (
          <ul aria-label={label} className="person-grid">
            {items.map((person) => (
              <PersonNamecard
                context={context}
                key={person.id}
                person={person}
              />
            ))}
            {adding ? (
              <li className="person-card person-add-card">
                <button
                  className="person-add-card-button"
                  onClick={() =>
                    quickAdd.update(quickAddPersonSlot, { isOpen: true })
                  }
                  type="button"
                >
                  <PlusIcon />
                  <span>{t("addPerson")}</span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        {adding ? (
          <div className="quick-add-item quick-add-people quick-add-cards">
            <QuickAddPerson slots={quickAdd} />
          </div>
        ) : null}
      </>
    );
  if (items.length === 0 && emptyNote === null && !adding) return null;
  return (
    <div className="person-list-card">
      {items.length > 0 ? (
        <ul aria-label={label} className="person-list">
          {items.map((person) => (
            <PersonRow context={context} key={person.id} person={person} />
          ))}
        </ul>
      ) : null}
      {emptyNote}
      {adding ? (
        <div className="person-add-row">
          <QuickAddPerson slots={quickAdd} />
        </div>
      ) : null}
    </div>
  );
}

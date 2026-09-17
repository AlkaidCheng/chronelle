"use client";

import type { PersonResponse } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { MailIcon, PhoneIcon, PlusIcon } from "../../components/icons";
import type { QuickAddSlots } from "../../components/quick-add-row";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import {
  type PersonLayout,
  personAccount,
  personInitials,
} from "../../lib/person-collection";
import { personDisplayName } from "../../lib/person-fields";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { QuickAddPerson, quickAddPersonSlot } from "./quick-add-person";

/** The letters that stand for a person, sized for a row, a card, or a page. */
export function PersonAvatar({
  name,
  size = "row",
}: {
  readonly name: string;
  readonly size?: "row" | "card" | "page";
}) {
  return (
    <span aria-hidden="true" className={`person-avatar person-avatar-${size}`}>
      {personInitials(name)}
    </span>
  );
}

/** "This is me" or "Has an account"; nothing for an unlinked person. */
export function PersonBadge({
  account,
}: {
  readonly account: "me" | "linked" | null;
}) {
  const t = useTranslations("people");
  if (account === null) return null;
  return (
    <span className={`person-badge person-badge-${account}`}>
      {account === "me" ? t("me") : t("hasAccount")}
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
    <ul aria-label={t("labels")} className="task-labels">
      {labels.map((label) => (
        <li className="task-label" key={label.id}>
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
 * labels, the account badge, and the row menu.
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
  return (
    <li aria-label={name} className="person-row" id={`person-${person.id}`}>
      <PersonAvatar name={name} />
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
      <PersonContacts person={person} />
      <PersonLabels labelNames={context.labelNames} person={person} />
      <span className="person-row-badge">
        <PersonBadge account={personAccount(person, context.me)} />
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
  return (
    <li aria-label={name} className="person-card" id={`person-${person.id}`}>
      <div className="person-card-top">
        <PersonAvatar name={name} size="card" />
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
        <PersonBadge account={personAccount(person, context.me)} />
        <PersonLabels labelNames={context.labelNames} person={person} />
      </div>
    </li>
  );
}

/**
 * The people of a collection in the chosen layout, ending with the quick
 * add row when the collection takes one (and, among namecards, a card
 * that opens that row).
 */
export function PersonListing({
  context,
  items,
  label,
  layout,
  quickAdd,
}: {
  readonly context: PersonRowContext;
  readonly items: readonly PersonResponse[];
  /** The accessible name of the list. */
  readonly label: string;
  readonly layout: PersonLayout;
  readonly quickAdd?: QuickAddSlots | undefined;
}) {
  const t = useTranslations("people");
  const Item = layout === "cards" ? PersonNamecard : PersonRow;
  let addCard: ReactNode = null;
  if (layout === "cards" && quickAdd !== undefined && context.canEdit)
    addCard = (
      <li className="person-card person-add-card">
        <button
          className="person-add-card-button"
          onClick={() => quickAdd.update(quickAddPersonSlot, { isOpen: true })}
          type="button"
        >
          <PlusIcon />
          <span>{t("addPerson")}</span>
        </button>
      </li>
    );
  return (
    <>
      {items.length > 0 || addCard !== null ? (
        <ul
          aria-label={label}
          className={layout === "cards" ? "person-grid" : "person-list"}
        >
          {items.map((person) => (
            <Item context={context} key={person.id} person={person} />
          ))}
          {addCard}
        </ul>
      ) : null}
      {quickAdd !== undefined && context.canEdit ? (
        <div className="quick-add-item quick-add-people">
          <QuickAddPerson slots={quickAdd} />
        </div>
      ) : null}
    </>
  );
}

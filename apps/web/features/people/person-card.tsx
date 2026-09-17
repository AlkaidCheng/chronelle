"use client";

import type { PersonResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";

import { RowActions } from "../events/component-frame";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { personDisplayName, propertyText } from "../../lib/person-fields";

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * One person as a namecard: initials, the nickname (the full name under
 * it) or the name, marked for the signed-in user, the linked-account note,
 * the contacts, the labels, the description, and the custom fields not
 * hidden; with Edit, History, and the lifecycle actions. Inside an Event
 * the actions offer removal from that event as well.
 */
export function PersonCard({
  eventId,
  hidden,
  isMe,
  labelNames,
  onEdit,
  person,
}: {
  /** The Event the card is shown in, when any. */
  readonly eventId?: string | undefined;
  readonly hidden: ReadonlySet<string>;
  readonly isMe: boolean;
  /** Label names by id; a label the container has not loaded shows nothing. */
  readonly labelNames?: ReadonlyMap<string, string> | undefined;
  readonly onEdit: (personId: string) => void;
  readonly person: PersonResponse;
}) {
  const t = useTranslations("person");
  const name = personDisplayName(person);
  const fields = Object.entries(person.customProperties).filter(
    ([key]) => !hidden.has(key),
  );
  const labels = person.labelIds.flatMap((id) => {
    const label = labelNames?.get(id);
    return label === undefined ? [] : [{ id, name: label }];
  });
  return (
    <li aria-label={name} className="person-card">
      <span aria-hidden="true" className="person-avatar">
        {initials(name)}
      </span>
      <div className="person-copy">
        <h3>
          {name}
          {isMe ? <span className="person-me"> (me)</span> : null}
        </h3>
        {person.nickname !== null ? (
          <p className="person-fullname">{person.displayName}</p>
        ) : null}
        {person.userId !== null && !isMe ? (
          <p className="person-linked">Has an account here</p>
        ) : null}
        {person.contacts.length > 0 ? (
          <ul aria-label={t("contacts")} className="person-contacts">
            {person.contacts.map((contact, index) => (
              // Contacts have no identity of their own; their position is it.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
              <li key={index}>
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
        ) : null}
        {labels.length > 0 ? (
          <ul aria-label={t("labels")} className="task-labels">
            {labels.map((label) => (
              <li className="task-label" key={label.id}>
                {label.name}
              </li>
            ))}
          </ul>
        ) : null}
        {person.description !== null ? (
          <p className="person-description">{person.description}</p>
        ) : null}
        {fields.length > 0 ? (
          <dl className="person-fields-list">
            {fields.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{propertyText(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <RowActions>
        <button
          aria-label={`Edit ${name}`}
          className="button button-quiet button-small"
          onClick={() => onEdit(person.id)}
          type="button"
        >
          Edit
        </button>
        <HistoryButton objectId={person.id} displayName={name} />
        <LifecycleButton
          target={eventId === undefined ? person : { ...person, eventId }}
        />
      </RowActions>
    </li>
  );
}

"use client";

import type { PersonResponse } from "@chronelle/schemas";

import { RowActions } from "../events/component-frame";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { propertyText } from "../../lib/person-fields";

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * One person as a namecard: initials, the name (marked for the signed-in
 * user), the email, the linked-account note, and the custom fields not
 * hidden; with Edit, History, and the lifecycle actions. Inside an Event
 * the actions offer removal from that event as well.
 */
export function PersonCard({
  eventId,
  hidden,
  isMe,
  onEdit,
  person,
}: {
  /** The Event the card is shown in, when any. */
  readonly eventId?: string | undefined;
  readonly hidden: ReadonlySet<string>;
  readonly isMe: boolean;
  readonly onEdit: (personId: string) => void;
  readonly person: PersonResponse;
}) {
  const fields = Object.entries(person.customProperties).filter(
    ([key]) => !hidden.has(key),
  );
  return (
    <li aria-label={person.displayName} className="person-card">
      <span aria-hidden="true" className="person-avatar">
        {initials(person.displayName)}
      </span>
      <div className="person-copy">
        <h3>
          {person.displayName}
          {isMe ? <span className="person-me"> (me)</span> : null}
        </h3>
        {person.email !== null ? (
          <a className="person-email" href={`mailto:${person.email}`}>
            {person.email}
          </a>
        ) : null}
        {person.userId !== null && !isMe ? (
          <p className="person-linked">Has an account here</p>
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
          aria-label={`Edit ${person.displayName}`}
          className="button button-quiet button-small"
          onClick={() => onEdit(person.id)}
          type="button"
        >
          Edit
        </button>
        <HistoryButton objectId={person.id} displayName={person.displayName} />
        <LifecycleButton
          target={eventId === undefined ? person : { ...person, eventId }}
        />
      </RowActions>
    </li>
  );
}

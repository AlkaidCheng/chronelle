"use client";

import type { PersonResponse } from "@chronelle/schemas";
import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { EmptyState, ErrorNotice } from "../../components/feedback";
import { useFriendsQuery } from "../../lib/friend-queries";
import { usePersonConnections } from "../../lib/use-person-connections";
import { personDisplayName } from "../../lib/person-fields";
import { PersonInspector } from "../people/person-inspector";
import { PersonListing } from "../people/person-row";
import {
  useCreatePersonInEvent,
  useEventAccessQuery,
  useIncludePerson,
  useLabelsQuery,
  usePersonsQuery,
  useSessionQuery,
  useSharesQuery,
} from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { PanelHeading } from "./component-frame";
import { ShareWithPeople, shareRows } from "./share-with-people";

/**
 * The people an Event involves, as namecards. Add person includes someone
 * the workspace already knows or creates a new person inside the event.
 */
export function PeoplePanel({
  canEdit,
  eventId,
  persons,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly persons: readonly PersonResponse[];
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const session = useSessionQuery();
  const me = session.data?.user.id;
  const labelNames = useLabelsQuery().data?.names;
  // Owners may share the event with the people it involves in one go.
  const access = useEventAccessQuery(eventId);
  const canShare = access.data?.actions.includes("share") ?? false;
  const shares = useSharesQuery(eventId, canShare);
  const friends = useFriendsQuery();
  const connections = usePersonConnections();
  const rows = useMemo(
    () =>
      shareRows({
        friends: friends.data?.friends ?? [],
        grants: shares.data?.items ?? [],
        me,
        pending: shares.data?.pending ?? [],
        people: persons,
        sent: friends.data?.sent ?? [],
        workspaceId: session.data?.workspace.id,
        scope: "people",
      }),
    [friends.data, me, persons, session.data, shares.data],
  );
  return (
    <section className="planning-panel">
      <PanelHeading
        title="People"
        action={
          canEdit ? (
            <button
              aria-haspopup="dialog"
              className="button button-secondary"
              onClick={(event) => {
                event.currentTarget.focus();
                setIsAdding(true);
              }}
              type="button"
            >
              Add person
            </button>
          ) : null
        }
      />
      {persons.length === 0 ? (
        <EmptyState title="No people yet" />
      ) : (
        <PersonListing
          context={{
            canEdit,
            connections,
            eventId,
            labelNames,
            me,
            onEdit: setEditingId,
          }}
          items={persons}
          label="People"
          layout="cards"
        />
      )}
      {canShare && rows.length > 0 ? (
        <details className="share-people-disclosure">
          <summary>Share with everyone here</summary>
          <ShareWithPeople
            eventId={eventId}
            initialSelected={rows.map((row) => row.key)}
            legend="Share this event with its people"
            rows={rows}
          />
        </details>
      ) : null}
      {isAdding
        ? createPortal(
            <AddPersonDialog
              eventId={eventId}
              included={persons}
              onClose={() => setIsAdding(false)}
            />,
            document.body,
          )
        : null}
      {editingId ? (
        <PersonInspector
          key={editingId}
          personId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </section>
  );
}

function AddPersonDialog({
  eventId,
  included,
  onClose,
}: {
  readonly eventId: string;
  readonly included: readonly PersonResponse[];
  readonly onClose: () => void;
}) {
  const dialog = useSessionDialog(onClose);
  const backdropPress = useRef(false);
  const id = useId();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const people = usePersonsQuery(true, { query: query.trim() });
  const include = useIncludePerson(eventId);
  const create = useCreatePersonInEvent(eventId);
  const pending = include.isPending || create.isPending;
  const error = include.error ?? create.error;
  const includedIds = new Set(included.map((person) => person.id));
  const candidates = (people.data?.items ?? []).filter(
    (person) => !includedIds.has(person.id),
  );

  function add() {
    const displayName = draft.trim();
    if (displayName === "" || pending) return;
    create.mutate({ displayName }, { onSuccess: onClose });
  }

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="event-create-dialog"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget)
          onClose();
        backdropPress.current = false;
      }}
      ref={dialog}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>Add person</h2>
        <button
          aria-label="Close add person"
          className="dialog-close"
          onClick={onClose}
          type="button"
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">
        <label className="field">
          <span>Find a person</span>
          <input
            onChange={(input) => setQuery(input.target.value)}
            placeholder="Search by name"
            type="search"
            value={query}
          />
        </label>
        {people.isError ? (
          <ErrorNotice
            error={people.error}
            onRefresh={() => void people.refetch()}
          />
        ) : people.data === undefined ? (
          <p className="field-hint">Loading people...</p>
        ) : candidates.length === 0 ? (
          <p className="field-hint">
            {query.trim() === ""
              ? "Everyone the workspace knows is already here."
              : "No one matches; add them below."}
          </p>
        ) : (
          <ul aria-label="People to add" className="label-manager">
            {candidates.map((person) => (
              <li key={person.id}>
                <span className="person-option">
                  {personDisplayName(person)}
                </span>
                <button
                  aria-label={`Add ${personDisplayName(person)}`}
                  className="button button-secondary button-small"
                  disabled={pending}
                  onClick={() =>
                    include.mutate(person.id, { onSuccess: onClose })
                  }
                  type="button"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="label-add">
          <label className="field">
            <span>New person</span>
            <input
              maxLength={240}
              onChange={(input) => setDraft(input.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                add();
              }}
              placeholder="Someone new to the workspace"
              value={draft}
            />
          </label>
          <button
            className="button button-secondary button-small"
            disabled={draft.trim() === "" || pending}
            onClick={add}
            type="button"
          >
            {create.isPending ? "Adding..." : "Add new person"}
          </button>
        </div>
        {error ? (
          <p role="alert">
            {error instanceof Error
              ? error.message
              : "The person could not be added."}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

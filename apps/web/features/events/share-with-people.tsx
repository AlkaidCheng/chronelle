"use client";

import type { PersonResponse, ShareResponse } from "@chronelle/schemas";
import { type FormEvent, useId, useState } from "react";

import { useShareResource } from "../../lib/queries";

type SharedRole = "owner" | "viewer";

type Outcome =
  | { readonly kind: "shared"; readonly role: SharedRole }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The people a share can reach: those with an account here, other than the
 * acting user's own person, and those with an email.
 */
export function shareablePeople(
  people: readonly PersonResponse[],
  me: string | undefined,
): PersonResponse[] {
  return people.filter(
    (person) =>
      (person.userId !== null && person.userId !== me) ||
      (person.userId === null && person.email !== null),
  );
}

/** The role a person's account already holds on the resource, if any. */
function currentRole(
  person: PersonResponse,
  grants: readonly ShareResponse[],
): string | undefined {
  const email = person.email?.toLowerCase();
  return grants.find(
    (grant) =>
      grant.principal.id === person.userId ||
      (person.userId === null &&
        email !== undefined &&
        grant.principal.email?.toLowerCase() === email),
  )?.role;
}

/**
 * Shares one resource with several people in one go: a list of people to
 * tick, one role, and the outcome of each share in place. Each person is
 * one share request, so a refusal leaves the others' grants standing.
 */
export function ShareWithPeople({
  eventId,
  grants,
  initialSelected = [],
  legend,
  people,
}: {
  readonly eventId: string;
  readonly grants: readonly ShareResponse[];
  /** People ticked when the control opens. */
  readonly initialSelected?: readonly string[];
  readonly legend: string;
  /** The people offered; see shareablePeople. */
  readonly people: readonly PersonResponse[];
}) {
  const id = useId();
  const share = useShareResource(eventId);
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [role, setRole] = useState<SharedRole>("viewer");
  const [outcomes, setOutcomes] = useState(() => new Map<string, Outcome>());
  const [isSharing, setIsSharing] = useState(false);
  const chosen = people.filter((person) => selected.has(person.id));

  async function handleShare(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (chosen.length === 0) return;
    setIsSharing(true);
    const results = new Map<string, Outcome>();
    for (const person of chosen) {
      try {
        const grant = await share.mutateAsync({ personId: person.id, role });
        results.set(person.id, {
          kind: "shared",
          role: grant.role === "owner" ? "owner" : "viewer",
        });
      } catch (error) {
        results.set(person.id, {
          kind: "failed",
          message:
            error instanceof Error
              ? error.message
              : "The share could not be completed.",
        });
      }
      setOutcomes(new Map(results));
    }
    setSelected(
      new Set(
        [...selected].filter(
          (personId) => results.get(personId)?.kind !== "shared",
        ),
      ),
    );
    setIsSharing(false);
  }

  const toggle = (personId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(personId);
      else next.delete(personId);
      return next;
    });

  return (
    <form className="share-people surface-subtle" onSubmit={handleShare}>
      <fieldset className="share-people-list" disabled={isSharing}>
        <legend>{legend}</legend>
        {people.length === 0 ? (
          <p className="field-hint">
            Give a person an email or link their account to share with them.
          </p>
        ) : (
          <ul aria-label={legend}>
            {people.map((person) => {
              const outcome = outcomes.get(person.id);
              const held = currentRole(person, grants);
              return (
                <li key={person.id}>
                  <label className="share-person">
                    <input
                      checked={selected.has(person.id)}
                      onChange={(input) =>
                        toggle(person.id, input.target.checked)
                      }
                      type="checkbox"
                    />
                    <span className="share-person-name">
                      {person.displayName}
                    </span>
                    <span className="share-person-reach">
                      {person.userId !== null
                        ? "Has an account here"
                        : person.email}
                    </span>
                    {held === undefined ? null : (
                      <span className={`status-chip status-${held}`}>
                        {held}
                      </span>
                    )}
                  </label>
                  {outcome === undefined ? null : (
                    <span
                      className={
                        outcome.kind === "shared"
                          ? "share-outcome"
                          : "share-outcome share-outcome-failed"
                      }
                      role="status"
                    >
                      {outcome.kind === "shared"
                        ? `Shared as ${outcome.role}`
                        : outcome.message}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      {people.length === 0 ? null : (
        <div className="share-people-actions">
          <label className="field">
            <span id={`${id}-role`}>Access</span>
            <select
              aria-labelledby={`${id}-role`}
              disabled={isSharing}
              onChange={(input) => setRole(input.target.value as SharedRole)}
              value={role}
            >
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button
            className="button button-primary"
            disabled={isSharing || chosen.length === 0}
            type="submit"
          >
            {isSharing
              ? "Sharing..."
              : `Share with ${chosen.length} ${chosen.length === 1 ? "person" : "people"}`}
          </button>
        </div>
      )}
    </form>
  );
}

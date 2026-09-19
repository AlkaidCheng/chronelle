"use client";

import type {
  Friend,
  PendingShare,
  PersonResponse,
  SentInvitation,
  ShareResponse,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";

import { personInitials } from "../../lib/person-collection";
import { personDisplayName, personEmail } from "../../lib/person-fields";
import { useQueuePendingShare, useShareResource } from "../../lib/queries";

type SharedRole = "owner" | "editor" | "viewer";

type Outcome =
  | { readonly kind: "shared"; readonly role: SharedRole }
  | { readonly kind: "queued"; readonly invited: boolean }
  | { readonly kind: "failed"; readonly message: string };

/**
 * One line of the share list: a friend (shared through the connection), a
 * person with an account here (shared through the card), a person already
 * invited (the share waits on that invitation), or a person with an email
 * and no account (the invitation goes out with the share).
 */
export interface ShareRow {
  readonly key: string;
  readonly group: "friends" | "others";
  readonly kind: "friend" | "member" | "invited" | "new";
  readonly name: string;
  readonly reach: string | null;
  readonly friendId: string | null;
  readonly personId: string | null;
  /** The role the account already holds, or the queued share waits with. */
  readonly held: SharedRole | undefined;
}

export interface ShareRowContext {
  readonly friends: readonly Friend[];
  readonly grants: readonly ShareResponse[];
  readonly me: string | undefined;
  readonly pending: readonly PendingShare[];
  readonly people: readonly PersonResponse[];
  readonly sent: readonly SentInvitation[];
  readonly workspaceId: string | undefined;
  /** "people": only friends who are among the people offered; "workspace": every friend. */
  readonly scope: "people" | "workspace";
}

/** The rows a share can reach, friends first, then the other people. */
export function shareRows(context: ShareRowContext): ShareRow[] {
  const friendByUser = new Map(
    context.friends.map((friend) => [friend.userId, friend]),
  );
  const heldByUser = new Map(
    context.grants.map((grant) => [grant.principal.id, grant.role]),
  );
  const queuedByPerson = new Map(
    context.pending.flatMap((share) =>
      share.person === null ? [] : [[share.person.id, share.role] as const],
    ),
  );
  const rows: ShareRow[] = [];
  for (const friend of context.friends) {
    const card = context.people.find(
      (person) => person.userId === friend.userId,
    );
    if (context.scope === "people" && card === undefined) continue;
    rows.push({
      key: `friend:${friend.id}`,
      group: "friends",
      kind: "friend",
      name: card === undefined ? friend.displayName : personDisplayName(card),
      reach: friend.email,
      friendId: friend.id,
      personId: card?.id ?? null,
      held: heldByUser.get(friend.userId),
    });
  }
  for (const person of context.people) {
    if (person.userId === context.me) continue;
    if (person.userId !== null && friendByUser.has(person.userId)) continue;
    const invited = context.sent.some(
      (item) =>
        item.personId === person.id &&
        (context.workspaceId === undefined ||
          item.workspaceId === context.workspaceId),
    );
    const email = personEmail(person);
    const kind =
      person.userId !== null
        ? "member"
        : invited
          ? "invited"
          : email !== null
            ? "new"
            : null;
    if (kind === null) continue;
    rows.push({
      key: `person:${person.id}`,
      group: "others",
      kind,
      name: personDisplayName(person),
      reach: kind === "member" ? null : email,
      friendId: null,
      personId: person.id,
      held:
        person.userId !== null
          ? heldByUser.get(person.userId)
          : queuedByPerson.get(person.id),
    });
  }
  return rows;
}

/**
 * Shares one resource with several people in one go: friends first with
 * the role beside each name, then the other people the workspace knows.
 * A friend or a person with an account is granted at once; an invited
 * person's share waits on the invitation; a person with only an email is
 * invited and the share waits. Each row is one request, so a refusal
 * leaves the others standing.
 */
export function ShareWithPeople({
  eventId,
  initialSelected = [],
  legend,
  rows,
}: {
  readonly eventId: string;
  /** Row keys ticked when the control opens. */
  readonly initialSelected?: readonly string[];
  readonly legend: string;
  readonly rows: readonly ShareRow[];
}) {
  const t = useTranslations("sharing");
  const id = useId();
  const share = useShareResource(eventId);
  const queue = useQueuePendingShare(eventId);
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [roles, setRoles] = useState(() => new Map<string, SharedRole>());
  const [outcomes, setOutcomes] = useState(() => new Map<string, Outcome>());
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState("");
  const chosen = rows.filter((row) => selected.has(row.key));
  const roleOf = (row: ShareRow): SharedRole =>
    roles.get(row.key) ?? row.held ?? "viewer";

  function copyLink() {
    const link = `${window.location.origin}/events/${eventId}`;
    navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(t("linkCopied")))
      .catch(() => setCopied(t("linkNotCopied")));
  }

  async function handleShare(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (chosen.length === 0) return;
    setIsSharing(true);
    const results = new Map<string, Outcome>();
    for (const row of chosen) {
      const role = roleOf(row);
      try {
        if (row.kind === "friend" && row.friendId !== null) {
          const grant = await share.mutateAsync({
            friendId: row.friendId,
            role,
          });
          results.set(row.key, { kind: "shared", role: grant.role });
        } else if (row.kind === "member" && row.personId !== null) {
          const grant = await share.mutateAsync({
            personId: row.personId,
            role,
          });
          results.set(row.key, { kind: "shared", role: grant.role });
        } else if (row.personId !== null) {
          await queue.mutateAsync({ personId: row.personId, role });
          results.set(row.key, { kind: "queued", invited: row.kind === "new" });
        }
      } catch (error) {
        results.set(row.key, {
          kind: "failed",
          message: error instanceof Error ? error.message : t("failed"),
        });
      }
      setOutcomes(new Map(results));
    }
    setSelected(
      new Set(
        [...selected].filter((key) => results.get(key)?.kind === "failed"),
      ),
    );
    setIsSharing(false);
  }

  const toggle = (key: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  const group = (name: "friends" | "others") => {
    const members = rows.filter((row) => row.group === name);
    if (members.length === 0) return null;
    return (
      <div className="share-group">
        <span className="share-group-title" id={`${id}-${name}`}>
          {t(name)}
        </span>
        <ul aria-labelledby={`${id}-${name}`} className="pick-list">
          {members.map((row) => {
            const outcome = outcomes.get(row.key);
            const ticked = selected.has(row.key);
            const waits = row.kind === "invited" || row.kind === "new";
            return (
              <li
                className={`pick-row${waits && !ticked ? " pick-row-off" : ""}`}
                key={row.key}
              >
                <label className="share-person">
                  <input
                    checked={ticked}
                    onChange={(input) => toggle(row.key, input.target.checked)}
                    type="checkbox"
                  />
                  <span
                    aria-hidden="true"
                    className={`person-avatar person-avatar-pick${waits ? "" : " person-avatar-linked"}`}
                  >
                    {personInitials(row.name)}
                  </span>
                  <span className="share-person-copy">
                    <span className="share-person-name">{row.name}</span>
                    <span className="share-person-reach">
                      {row.kind === "member"
                        ? t("hasAccount")
                        : row.kind === "invited"
                          ? t("invitedAccessFollows")
                          : row.kind === "new"
                            ? t("invitationOnShare", { email: row.reach ?? "" })
                            : row.reach}
                      {row.held === undefined
                        ? null
                        : ` \u00b7 ${t("already", { role: t(`roles.${row.held}` as "roles.viewer") })}`}
                    </span>
                  </span>
                </label>
                <select
                  aria-label={t("accessFor", { name: row.name })}
                  className="share-person-role"
                  disabled={isSharing}
                  onChange={(input) =>
                    setRoles((current) =>
                      new Map(current).set(
                        row.key,
                        input.target.value as SharedRole,
                      ),
                    )
                  }
                  value={roleOf(row)}
                >
                  <option value="viewer">{t("roles.viewer")}</option>
                  <option value="editor">{t("roles.editor")}</option>
                  <option value="owner">{t("roles.owner")}</option>
                </select>
                {outcome === undefined ? null : (
                  <span
                    className={
                      outcome.kind === "failed"
                        ? "share-outcome share-outcome-failed"
                        : "share-outcome"
                    }
                    role="status"
                  >
                    {outcome.kind === "shared"
                      ? t("sharedAs", { role: t(`roles.${outcome.role}`) })
                      : outcome.kind === "queued"
                        ? outcome.invited
                          ? t("invitationSent")
                          : t("queued")
                        : outcome.message}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <form className="share-people" onSubmit={handleShare}>
      <fieldset className="share-people-list" disabled={isSharing}>
        <legend className="visually-hidden">{legend}</legend>
        {rows.length === 0 ? (
          <p className="field-hint">{t("nobody")}</p>
        ) : (
          <>
            {group("friends")}
            {group("others")}
          </>
        )}
      </fieldset>
      {rows.length === 0 ? null : (
        <div className="share-people-actions">
          <span className="share-copied" role="status">
            {copied}
          </span>
          <button
            className="button button-quiet"
            onClick={copyLink}
            type="button"
          >
            {t("copyLink")}
          </button>
          <button
            className="button button-primary"
            disabled={isSharing || chosen.length === 0}
            type="submit"
          >
            {isSharing
              ? t("sharing")
              : t("shareWith", { count: chosen.length })}
          </button>
        </div>
      )}
    </form>
  );
}

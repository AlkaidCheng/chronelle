"use client";

import type { PersonResponse, ShareResponse } from "@livtales/schemas";

type Role = ShareResponse["role"];
/** The roles a single record is shared with. */
type ShareRole = Exclude<Role, "owner">;
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { ErrorNotice } from "../../components/feedback";
import { copyText } from "../../lib/copy-text";
import { formatEventSchedule } from "../../lib/event-schedule";
import { useFriendsQuery } from "../../lib/friend-queries";
import {
  useEventsQuery,
  useQueuePendingShare,
  useShareResource,
} from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

type Outcome =
  | { readonly kind: "shared"; readonly event: string; readonly role: Role }
  | {
      readonly kind: "queued";
      readonly event: string;
      /** The invitation link the share waits on, when the person has no address. */
      readonly link: string | null;
    }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Shares one of the account's events with the person: pick the event from
 * a searchable list, choose the role, and Share. A person with an account
 * (linked, or the one account with their email) is granted at once; an
 * invited person's share waits on the invitation, which goes out when none
 * does (emailed, or a link to hand on with Copy link when the card has no
 * address). The dialog stays open with the outcome so another event can
 * follow.
 */
export function ShareWithPersonDialog({
  person,
  personName,
  hasAccount,
  onClose,
}: {
  readonly person: Pick<PersonResponse, "id">;
  readonly personName: string;
  /** Whether the person stands for an account here, so a grant applies at once. */
  readonly hasAccount: boolean;
  readonly onClose: () => void;
}) {
  const t = useTranslations("personPage.shareDialog");
  const page = useTranslations("personPage");
  const roles = useTranslations("access");
  const dialog = useSessionDialog(onClose);
  const id = useId();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [role, setRole] = useState<ShareRole>("viewer");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const friends = useFriendsQuery();
  const events = useEventsQuery({
    query: debounced,
    filter: "all",
    sort: "updated",
  });
  const items = events.data?.items ?? [];
  const chosen = items.find((event) => event.id === eventId);

  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const share = useShareResource(chosen?.id ?? "");
  const queue = useQueuePendingShare(chosen?.id ?? "");
  const busy = share.isPending || queue.isPending;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (chosen === undefined || busy) return;
    setOutcome(null);
    try {
      if (hasAccount) {
        const grant = await share.mutateAsync({ personId: person.id, role });
        setOutcome({
          kind: "shared",
          event: chosen.displayName,
          role: grant.role,
        });
      } else {
        const pending = await queue.mutateAsync({ personId: person.id, role });
        const link =
          pending.email === null
            ? ((await friends.refetch()).data?.sent.find(
                (item) => item.id === pending.itemId,
              )?.inviteUrl ?? null)
            : null;
        setOutcome({ kind: "queued", event: chosen.displayName, link });
      }
      setEventId(null);
    } catch (error) {
      setOutcome({
        kind: "failed",
        message: error instanceof Error ? error.message : t("failed"),
      });
    }
  }

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="event-create-dialog share-person-dialog"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!busy) onClose();
      }}
      ref={dialog}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>{t("title", { name: personName })}</h2>
        <button
          aria-label={t("close")}
          className="dialog-close"
          disabled={busy}
          onClick={onClose}
          type="button"
        >
          &#215;
        </button>
      </header>
      <form className="event-create-body" onSubmit={submit} aria-busy={busy}>
        <p className="field-hint">{t("intro", { name: personName })}</p>
        <label className="field">
          <span>{t("find")}</span>
          <input
            autoComplete="off"
            maxLength={240}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("placeholder")}
            ref={search}
            type="search"
            value={query}
          />
        </label>
        <fieldset className="share-person-events" disabled={busy}>
          <legend>{t("events")}</legend>
          {items.length === 0 && !events.isPending ? (
            <p className="kv-empty">{t("noEvents")}</p>
          ) : (
            <ul className="share-person-list">
              {items.map((event) => {
                const when = formatEventSchedule(event);
                return (
                  <li key={event.id}>
                    <label className="share-person-choice">
                      <input
                        checked={eventId === event.id}
                        name={`${id}-event`}
                        onChange={() => setEventId(event.id)}
                        type="radio"
                        value={event.id}
                      />
                      <span>
                        <strong>{event.displayName}</strong>
                        {when === "" ? null : <small>{when}</small>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        <label className="field share-person-role">
          <span>{t("role")}</span>
          <select
            disabled={busy}
            onChange={(event) => setRole(event.target.value as ShareRole)}
            value={role}
          >
            <option value="viewer">{roles("roles.viewer")}</option>
            <option value="editor">{roles("roles.editor")}</option>
          </select>
        </label>
        {outcome === null ? null : outcome.kind === "failed" ? (
          <ErrorNotice error={new Error(outcome.message)} />
        ) : (
          <p className="share-person-outcome" role="status">
            {outcome.kind === "shared"
              ? t("shared", {
                  event: outcome.event,
                  role: roles(`roles.${outcome.role}`),
                })
              : outcome.link === null
                ? t("queued", { event: outcome.event })
                : t("waitingOnLink", { event: outcome.event })}
            {outcome.kind === "queued" && outcome.link !== null ? (
              <>
                <button
                  className="link-button share-outcome-copy"
                  onClick={async () =>
                    setCopied(
                      (await copyText(outcome.link ?? ""))
                        ? page("linkCopied")
                        : page("linkNotCopied"),
                    )
                  }
                  type="button"
                >
                  {t("copyInvite")}
                </button>
                <span className="visually-hidden">{copied}</span>
              </>
            ) : null}
          </p>
        )}
        <div className="form-actions">
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            {t("done")}
          </button>
          <button
            className="button button-primary"
            disabled={busy || chosen === undefined}
            type="submit"
          >
            {busy ? t("sharing") : t("share")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

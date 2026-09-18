"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { CheckIcon, UserPlusIcon } from "../../components/icons";
import {
  useInviteFriend,
  useRequestFriend,
  useUserSearchQuery,
} from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import { personDisplayName } from "../../lib/person-fields";
import { usePersonsQuery, useSessionQuery } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

const someoneNew = "";

/**
 * Invite a friend. Find people first: accounts by name, @username, or
 * email, as each lets itself be found, each with Add friend or the state
 * that already holds. Below, for someone not on Chronelle yet: a person of
 * the current workspace who has an email and no account link, or someone
 * new by address, with an optional note; the request or invitation is
 * sent on submit and the dialog closes. From a card, the search starts
 * with the card's name so a match shows first, and a request from a row
 * links the card when they accept.
 */
export function InviteFriendDialog({
  onClose,
  personId: initialPersonId = someoneNew,
}: {
  readonly onClose: () => void;
  readonly personId?: string | undefined;
}) {
  const t = useTranslations("friends");
  const dialog = useSessionDialog(onClose);
  const backdropPress = useRef(false);
  const id = useId();
  const people = usePersonsQuery();
  const session = useSessionQuery();
  const invite = useInviteFriend();
  const request = useRequestFriend();
  const me = session.data?.user.id;
  const candidates = (people.data?.items ?? []).filter(
    (person) => person.userId === null && person.email !== null,
  );
  const [personId, setPersonId] = useState(initialPersonId);
  const chosen = candidates.find((person) => person.id === personId);
  const [email, setEmail] = useState(chosen?.email ?? "");
  const [message, setMessage] = useState("");
  const address = chosen?.email ?? email;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const search = useUserSearchQuery(debounced);
  const [requested, setRequested] = useState<string | null>(null);
  // From a card, the search starts with the card's name once it is known.
  const card = (people.data?.items ?? []).find(
    (person) => person.id === initialPersonId,
  );
  const cardName = card === undefined ? "" : personDisplayName(card);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || cardName === "") return;
    seeded.current = true;
    setQuery(cardName);
    setDebounced(cardName);
  }, [cardName]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results =
    debounced.trim().length >= 2 ? (search.data?.items ?? []) : [];

  function choosePerson(next: string) {
    setPersonId(next);
    const person = candidates.find((candidate) => candidate.id === next);
    if (person?.email) setEmail(person.email);
  }

  function addFriend(userId: string) {
    setRequested(userId);
    request.mutate({
      userId,
      ...(message.trim() !== "" && { message: message.trim() }),
      ...(chosen !== undefined && { personId: chosen.id }),
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (address.trim() === "" || invite.isPending) return;
    invite.mutate(
      {
        email: address,
        ...(message.trim() !== "" && { message: message.trim() }),
        ...(chosen !== undefined && { personId: chosen.id }),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="event-create-dialog invite-dialog"
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
        <h2 id={`${id}-title`}>{t("invite")}</h2>
        <button
          aria-label={t("closeInvite")}
          className="dialog-close"
          onClick={onClose}
          type="button"
        >
          &#215;
        </button>
      </header>
      <form className="event-create-body invite-form" onSubmit={handleSubmit}>
        <h3 className="invite-section">{t("findPeople")}</h3>
        <div className="field">
          <input
            aria-describedby={`${id}-search-hint`}
            aria-label={t("searchLabel")}
            autoComplete="off"
            maxLength={254}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            type="search"
            value={query}
          />
          <span className="field-hint" id={`${id}-search-hint`}>
            {t("searchHint")}
          </span>
        </div>
        {results.length > 0 ? (
          <ul aria-label={t("findPeople")} className="people-results">
            {results.map((account) => {
              const pending = request.isPending && requested === account.id;
              return (
                <li className="people-result" key={account.id}>
                  <span
                    aria-hidden="true"
                    className={`person-avatar person-avatar-card${
                      account.relation === "friend"
                        ? " person-avatar-linked"
                        : ""
                    }`}
                  >
                    {personInitials(account.displayName)}
                  </span>
                  <span className="people-result-name">
                    <strong className="people-result-title">
                      {account.displayName}
                    </strong>
                    <span className="people-result-handle">
                      @{account.username}
                    </span>
                  </span>
                  {account.relation === "none" ? (
                    <button
                      className="button button-secondary"
                      disabled={request.isPending}
                      onClick={() => addFriend(account.id)}
                      type="button"
                    >
                      <UserPlusIcon />
                      {pending ? t("adding") : t("addFriend")}
                    </button>
                  ) : (
                    <span className="people-result-state">
                      {account.relation === "friend" ? (
                        <CheckIcon className="people-result-check" />
                      ) : null}
                      {t(
                        account.relation === "friend"
                          ? "alreadyFriends"
                          : account.relation === "requested"
                            ? "requestSent"
                            : "wantsYou",
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : debounced.trim().length >= 2 && !search.isPending ? (
          <p className="kv-empty" role="status">
            {t("noMatch")}
          </p>
        ) : null}
        {request.isError ? <ErrorNotice error={request.error} /> : null}
        <h3 className="invite-section">{t("notYet")}</h3>
        <p className="field-hint">{t("inviteNote")}</p>
        <label className="field">
          <span>{t("person")}</span>
          <select
            onChange={(event) => choosePerson(event.target.value)}
            value={personId}
          >
            <option value={someoneNew}>{t("someoneNew")}</option>
            {candidates
              .filter((person) => person.userId !== me)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {personDisplayName(person)}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>{t("email")}</span>
          <input
            autoComplete="off"
            disabled={chosen !== undefined}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={address}
          />
        </label>
        <label className="field">
          <span>{t("note")}</span>
          <textarea
            maxLength={500}
            onChange={(event) => setMessage(event.target.value)}
            rows={3}
            value={message}
          />
        </label>
        {invite.isError ? <ErrorNotice error={invite.error} /> : null}
        <div className="form-actions">
          <button
            className="button button-quiet"
            onClick={onClose}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="button button-primary"
            disabled={address.trim() === "" || invite.isPending}
            type="submit"
          >
            {invite.isPending ? t("sending") : t("send")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

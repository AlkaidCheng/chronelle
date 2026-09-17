"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { useInviteFriend } from "../../lib/friend-queries";
import { personDisplayName } from "../../lib/person-fields";
import { usePersonsQuery, useSessionQuery } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

const someoneNew = "";

/**
 * Invite a friend: a person of the current workspace who has an email and
 * no account link yet, or someone new by address, with an optional note.
 * The address is the person's first email when a person is chosen. The
 * request or invitation is sent on submit and the dialog closes.
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
  const me = session.data?.user.id;
  const candidates = (people.data?.items ?? []).filter(
    (person) => person.userId === null && person.email !== null,
  );
  const [personId, setPersonId] = useState(initialPersonId);
  const chosen = candidates.find((person) => person.id === personId);
  const [email, setEmail] = useState(chosen?.email ?? "");
  const [message, setMessage] = useState("");
  const address = chosen?.email ?? email;

  function choosePerson(next: string) {
    setPersonId(next);
    const person = candidates.find((candidate) => candidate.id === next);
    if (person?.email) setEmail(person.email);
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

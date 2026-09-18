"use client";

import type { PersonResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";

import {
  ClockIcon,
  LinkIcon,
  PeopleIcon,
  UserPlusIcon,
} from "../../components/icons";
import { useNotices } from "../../components/notices";
import {
  useFriendsQuery,
  useResendInvitation,
  useWithdrawInvitation,
} from "../../lib/friend-queries";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { useUpdatePerson, useWorkspaceMembersQuery } from "../../lib/queries";
import type { PersonAccountState } from "./person-row";

/**
 * The Connection panel of a person's page: what account stands behind the
 * card. A friend is named with the date the connection was made and, when
 * the friend belongs to this workspace, their role; an invitation sent
 * from the card shows when, with Resend and Withdraw; a card without an
 * account offers to link or invite. Unlink takes the account off the card.
 */
export function PersonConnection({
  account,
  canEdit,
  onInvite,
  onLink,
  person,
}: {
  readonly account: PersonAccountState;
  readonly canEdit: boolean;
  /** Opens Invite a friend for this card. */
  readonly onInvite: () => void;
  /** Opens the editor, where Link to a friend lives. */
  readonly onLink: () => void;
  readonly person: PersonResponse;
}) {
  const t = useTranslations("personPage");
  const verbs = useTranslations("verbs");
  const done = useTranslations("done");
  const members = useTranslations("members");
  const { post } = useNotices();
  const { locale, instant } = useDisplayPreferences();
  const friends = useFriendsQuery();
  const workspace = useWorkspaceMembersQuery();
  const update = useUpdatePerson();
  const resend = useResendInvitation();
  const withdraw = useWithdrawInvitation();
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(instant.timeZone !== undefined && { timeZone: instant.timeZone }),
    }).format(new Date(iso));
  const friend = friends.data?.friends.find(
    (candidate) => candidate.userId === person.userId,
  );
  const member = workspace.data?.items.find(
    (candidate) => candidate.userId === person.userId,
  );
  const invitation = friends.data?.sent.find(
    (candidate) => candidate.personId === person.id,
  );
  const canInvite = person.contacts.some((contact) => contact.kind === "email");

  function unlink() {
    update.mutate(
      {
        id: person.id,
        input: { expectedVersion: person.version, userId: null },
      },
      { onSuccess: () => post({ message: done("personUnlinked") }) },
    );
  }

  return (
    <section aria-labelledby="person-connection" className="quiet-panel">
      <header className="quiet-panel-head">
        <h2 id="person-connection">{t("connection")}</h2>
      </header>
      <div className="connection-lines">
        {account === "me" ? (
          <p className="connection-line">
            <LinkIcon />
            <span>{t("thisIsYou")}</span>
          </p>
        ) : account === "friend" && friend !== undefined ? (
          <p className="connection-line">
            <LinkIcon />
            <span>
              {t.rich("linkedFriend", {
                name: friend.displayName,
                b: (chunks) => <b>{chunks}</b>,
              })}
            </span>
            <span className="connection-when">
              {t("friendsSince", { date: day(friend.since) })}
            </span>
          </p>
        ) : account === "friend" || account === "linked" ? (
          <p className="connection-line">
            <LinkIcon />
            <span>{t("linkedAccount")}</span>
          </p>
        ) : account === "invited" && invitation !== undefined ? (
          <p className="connection-line">
            <ClockIcon />
            <span>
              {t.rich("invitationSent", {
                email: invitation.email,
                b: (chunks) => <b>{chunks}</b>,
              })}
            </span>
            <span className="connection-when">{day(invitation.createdAt)}</span>
          </p>
        ) : (
          <p className="connection-line">
            <UserPlusIcon />
            <span>{t("notLinked")}</span>
          </p>
        )}
        {member !== undefined && account !== "me" ? (
          <p className="connection-line">
            <PeopleIcon />
            <span>
              {t.rich("memberAs", {
                role: members(`roles.${member.role}`),
                b: (chunks) => <b>{chunks}</b>,
              })}
            </span>
          </p>
        ) : null}
        {canEdit ? (
          <p className="connection-line connection-actions">
            {account === "friend" || account === "linked" ? (
              <button
                className="link-button"
                disabled={update.isPending}
                onClick={unlink}
                type="button"
              >
                {verbs("unlinkPerson")}
              </button>
            ) : account === "invited" && invitation !== undefined ? (
              <>
                <button
                  className="link-button"
                  disabled={resend.isPending || withdraw.isPending}
                  onClick={() =>
                    resend.mutate(invitation.id, {
                      onSuccess: () =>
                        post({ message: done("invitationResent") }),
                    })
                  }
                  type="button"
                >
                  {t("resend")}
                </button>
                <button
                  className="link-button"
                  disabled={resend.isPending || withdraw.isPending}
                  onClick={() =>
                    withdraw.mutate(invitation.id, {
                      onSuccess: () =>
                        post({ message: done("invitationWithdrawn") }),
                    })
                  }
                  type="button"
                >
                  {verbs("withdrawInvitation")}
                </button>
              </>
            ) : account === null ? (
              <>
                <button className="link-button" onClick={onLink} type="button">
                  {t("linkToFriend")}
                </button>
                {canInvite ? (
                  <button
                    className="link-button"
                    onClick={onInvite}
                    type="button"
                  >
                    {t("invite")}
                  </button>
                ) : null}
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

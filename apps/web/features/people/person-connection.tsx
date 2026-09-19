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
import { useState } from "react";

import { copyText } from "../../lib/copy-text";
import {
  useFriendsQuery,
  useRenewInvitationLink,
  useResendInvitation,
  useWithdrawInvitation,
} from "../../lib/friend-queries";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { useUpdatePerson, useWorkspaceMembersQuery } from "../../lib/queries";
import type { PersonAccountState } from "./person-row";

/**
 * The Connection panel of a person's page: what account stands behind the
 * card. A friend is named with the date the connection was made and, when
 * the friend belongs to this workspace, their role; a request sent from
 * the card shows the address, with Withdraw; an invitation shows whether
 * it was emailed or made as a link and until when it is valid, with Copy
 * link, Send by email (when it has an address), New link, and Withdraw; a
 * card without an account offers to link or invite. Unlink takes the
 * account off the card.
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
  const renew = useRenewInvitationLink();
  const withdraw = useWithdrawInvitation();
  const [copied, setCopied] = useState("");
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
  const acting = resend.isPending || renew.isPending || withdraw.isPending;

  async function copyInvite() {
    if (invitation?.inviteUrl == null) return;
    setCopied(
      (await copyText(invitation.inviteUrl))
        ? t("linkCopied")
        : t("linkNotCopied"),
    );
  }

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
              {invitation.kind === "connection"
                ? t.rich("requestSent", {
                    email: invitation.email ?? "",
                    b: (chunks) => <b>{chunks}</b>,
                  })
                : invitation.channel === "email" && invitation.email !== null
                  ? t.rich("invitationSent", {
                      email: invitation.email,
                      b: (chunks) => <b>{chunks}</b>,
                    })
                  : t("linkCreated", { date: day(invitation.createdAt) })}
            </span>
            {invitation.expiresAt === null ? (
              <span className="connection-when">
                {day(invitation.createdAt)}
              </span>
            ) : (
              <span className="connection-when">
                {t("validUntil", { date: day(invitation.expiresAt) })}
              </span>
            )}
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
                {invitation.inviteUrl === null ? null : (
                  <button
                    className="link-button"
                    disabled={acting}
                    onClick={copyInvite}
                    type="button"
                  >
                    {t("copyInvite")}
                  </button>
                )}
                {invitation.kind === "connection" ||
                invitation.email !== null ? (
                  <button
                    className="link-button"
                    disabled={acting}
                    onClick={() =>
                      resend.mutate(invitation.id, {
                        onSuccess: () =>
                          post({ message: done("invitationResent") }),
                      })
                    }
                    type="button"
                  >
                    {invitation.kind === "connection"
                      ? t("resend")
                      : t("sendByEmail")}
                  </button>
                ) : null}
                {invitation.kind === "invitation" ? (
                  <button
                    className="link-button"
                    disabled={acting}
                    onClick={() =>
                      renew.mutate(invitation.id, {
                        onSuccess: () => post({ message: done("linkRenewed") }),
                      })
                    }
                    type="button"
                  >
                    {t("newLink")}
                  </button>
                ) : null}
                <button
                  className="link-button"
                  disabled={acting}
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
                <span className="visually-hidden" role="status">
                  {copied}
                </span>
              </>
            ) : account === null ? (
              <>
                <button className="link-button" onClick={onLink} type="button">
                  {t("linkToFriend")}
                </button>
                <button
                  className="link-button"
                  onClick={onInvite}
                  type="button"
                >
                  {t("invite")}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

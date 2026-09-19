"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmAction } from "../../components/confirm-action";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import {
  ClockIcon,
  GridIcon,
  LinkIcon,
  MailIcon,
  UserPlusIcon,
} from "../../components/icons";
import { useNotices } from "../../components/notices";
import { copyText } from "../../lib/copy-text";
import {
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useFriendsQuery,
  useRemoveFriend,
  useRenewInvitationLink,
  useResendInvitation,
  useWithdrawInvitation,
} from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import { usePersonsQuery, useSessionQuery } from "../../lib/queries";
import { formatRelativeTime } from "../../lib/relative-time";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { InviteFriendDialog } from "./invite-friend-dialog";
import { YourCodeDialog } from "./your-code-dialog";

/**
 * Friends, reached from the profile menu. Friends belong to the account,
 * not to a workspace: the requests waiting for an answer, the friends by
 * name, and what was sent and still waits: a request to an account, or an
 * invitation link, emailed or handed on. A sent row names the person of
 * this workspace the invitation went from, when there is one, and offers
 * Copy link, Resend (an emailed one) or New link, and Withdraw. Every
 * action answers at once; the list reads again after it. Your code shows
 * the QR code and link others scan to send a request.
 */
export function FriendsPage() {
  const t = useTranslations("friends");
  const verbs = useTranslations("verbs");
  const confirm = useTranslations("confirm");
  const done = useTranslations("done");
  const { post } = useNotices();
  const friends = useFriendsQuery();
  const [inviting, setInviting] = useState(false);
  const [showingCode, setShowingCode] = useState(false);
  const { locale, instant } = useDisplayPreferences();
  const accept = useAcceptFriendRequest();
  const decline = useDeclineFriendRequest();
  const withdraw = useWithdrawInvitation();
  const resend = useResendInvitation();
  const renew = useRenewInvitationLink();
  const remove = useRemoveFriend();
  const [copied, setCopied] = useState("");
  const busy =
    accept.isPending ||
    decline.isPending ||
    withdraw.isPending ||
    resend.isPending ||
    renew.isPending ||
    remove.isPending;
  const failure = [accept, decline, withdraw, resend, renew, remove].find(
    (mutation) => mutation.isError,
  );
  const copyInvite = async (link: string) =>
    setCopied((await copyText(link)) ? t("linkCopied") : t("linkNotCopied"));
  const session = useSessionQuery();
  const persons = usePersonsQuery();
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(instant.timeZone !== undefined && { timeZone: instant.timeZone }),
    }).format(new Date(iso));
  const ago = (iso: string) => formatRelativeTime(iso, locale);
  const personNameOf = (personId: string | null, workspaceId: string | null) =>
    personId !== null && workspaceId === session.data?.workspace.id
      ? persons.data?.items.find((person) => person.id === personId)
          ?.displayName
      : undefined;
  return (
    <main className="workspace-page friends-page" tabIndex={-1}>
      <header className="quiet-heading">
        <h1>{t("title")}</h1>
        <div className="quiet-heading-actions">
          <button
            aria-haspopup="dialog"
            className="button button-secondary"
            onClick={() => setShowingCode(true)}
            type="button"
          >
            <GridIcon />
            {t("yourCode")}
          </button>
          <button
            aria-haspopup="dialog"
            className="button button-primary"
            onClick={() => setInviting(true)}
            type="button"
          >
            <UserPlusIcon />
            {t("invite")}
          </button>
        </div>
      </header>
      <p className="page-intro">{t("intro")}</p>
      {inviting ? (
        <InviteFriendDialog onClose={() => setInviting(false)} />
      ) : null}
      {showingCode ? (
        <YourCodeDialog onClose={() => setShowingCode(false)} />
      ) : null}
      {friends.isError ? (
        <ErrorNotice
          error={friends.error}
          onRefresh={() => void friends.refetch()}
        />
      ) : friends.data === undefined ? (
        <LoadingState label={t("loading")} />
      ) : (
        <div className="friends-layout">
          {failure ? <ErrorNotice error={failure.error} /> : null}
          {friends.data.incoming.length > 0 ? (
            <section aria-labelledby="friend-requests" className="quiet-panel">
              <header className="quiet-panel-head">
                <h2 id="friend-requests">{t("requests")}</h2>
                <span className="quiet-panel-count">
                  {friends.data.incoming.length}
                </span>
              </header>
              <ul className="request-list">
                {friends.data.incoming.map((request) => (
                  <li className="request-row" key={request.id}>
                    <span
                      aria-hidden="true"
                      className="person-avatar person-avatar-card"
                    >
                      {personInitials(request.requester.displayName)}
                    </span>
                    <div className="request-body">
                      <p className="request-line">
                        <strong>{request.requester.displayName}</strong>{" "}
                        <span className="request-verb">
                          {t("wantsToConnect")}
                        </span>
                        <span className="request-meta">
                          {request.requester.email === null
                            ? ""
                            : ` \u00b7 ${request.requester.email}`}
                          {` \u00b7 ${ago(request.createdAt)}`}
                        </span>
                      </p>
                      {request.message !== null ? (
                        <blockquote className="request-note">
                          {request.message}
                        </blockquote>
                      ) : null}
                      <div className="request-actions">
                        <button
                          className="button button-primary button-small"
                          disabled={busy}
                          onClick={() => accept.mutate(request.id)}
                          type="button"
                        >
                          {t("accept")}
                        </button>
                        <button
                          className="button button-quiet button-small"
                          disabled={busy}
                          onClick={() => decline.mutate(request.id)}
                          type="button"
                        >
                          {t("decline")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="friend-list" className="quiet-panel">
            <header className="quiet-panel-head">
              <h2 id="friend-list">{t("friends")}</h2>
              <span className="quiet-panel-count">
                {friends.data.friends.length}
              </span>
            </header>
            {friends.data.friends.length === 0 ? (
              <p className="kv-empty">{t("noFriends")}</p>
            ) : (
              <ul className="srow-list">
                {friends.data.friends.map((friend) => (
                  <li className="srow" key={friend.id}>
                    <span
                      aria-hidden="true"
                      className="person-avatar person-avatar-mini person-avatar-linked"
                    >
                      {personInitials(friend.displayName)}
                    </span>
                    <span className="srow-name">
                      {friend.displayName}
                      {friend.email === null ? null : (
                        <span className="srow-meta">
                          {" \u00b7 "}
                          {friend.email}
                        </span>
                      )}
                    </span>
                    <span className="srow-dir">
                      {t("since", { date: day(friend.since) })}
                    </span>
                    <ConfirmAction
                      className="link-button link-button-quiet"
                      disabled={busy}
                      label={verbs("removeFriend")}
                      onConfirm={() =>
                        remove.mutate(friend.id, {
                          onSuccess: () =>
                            post({ message: done("friendRemoved") }),
                        })
                      }
                      pending={remove.isPending}
                      question={confirm("removeFriend")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {friends.data.sent.length > 0 ? (
            <section aria-labelledby="friend-sent" className="quiet-panel">
              <header className="quiet-panel-head">
                <h2 id="friend-sent">{t("sent")}</h2>
                <span className="quiet-panel-count">
                  {friends.data.sent.length}
                </span>
              </header>
              <ul className="srow-list">
                {friends.data.sent.map((item) => {
                  const name = personNameOf(item.personId, item.workspaceId);
                  const kind =
                    item.kind === "connection"
                      ? "kindRequest"
                      : item.channel === "email"
                        ? "kindEmail"
                        : "kindLink";
                  return (
                    <li className="srow srow-sent" key={item.id}>
                      {kind === "kindLink" ? <LinkIcon /> : <MailIcon />}
                      <span className="srow-name">
                        {name ?? item.email ?? t("invitationLink")}
                        {name === undefined || item.email === null ? null : (
                          <span className="srow-meta">
                            {" \u00b7 "}
                            {item.email}
                          </span>
                        )}
                        <span className="srow-sub">
                          {t(kind)}
                          {" \u00b7 "}
                          {item.expiresAt === null
                            ? t("sentAgo", { when: ago(item.createdAt) })
                            : t("validUntil", { date: day(item.expiresAt) })}
                        </span>
                      </span>
                      <span className="person-badge person-badge-invited">
                        <ClockIcon />
                        {item.expiresAt === null
                          ? t("sentAgo", { when: ago(item.createdAt) })
                          : t("noAccountYet")}
                      </span>
                      {item.inviteUrl === null ? null : (
                        <button
                          className="link-button link-button-quiet"
                          disabled={busy}
                          onClick={() => copyInvite(item.inviteUrl ?? "")}
                          type="button"
                        >
                          {t("copyLink")}
                        </button>
                      )}
                      {kind === "kindLink" ? (
                        <button
                          className="link-button link-button-quiet"
                          disabled={busy}
                          onClick={() =>
                            renew.mutate(item.id, {
                              onSuccess: () =>
                                post({ message: done("linkRenewed") }),
                            })
                          }
                          type="button"
                        >
                          {t("newLink")}
                        </button>
                      ) : (
                        <button
                          className="link-button link-button-quiet"
                          disabled={busy}
                          onClick={() =>
                            resend.mutate(item.id, {
                              onSuccess: () =>
                                post({ message: done("invitationResent") }),
                            })
                          }
                          type="button"
                        >
                          {t("resend")}
                        </button>
                      )}
                      <button
                        className="link-button link-button-quiet"
                        disabled={busy}
                        onClick={() =>
                          withdraw.mutate(item.id, {
                            onSuccess: () =>
                              post({ message: done("invitationWithdrawn") }),
                          })
                        }
                        type="button"
                      >
                        {verbs("withdrawInvitation")}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="visually-hidden" role="status">
                {copied}
              </p>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

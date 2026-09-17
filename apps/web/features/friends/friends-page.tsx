"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import { UserPlusIcon } from "../../components/icons";
import {
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useFriendsQuery,
  useRemoveFriend,
  useResendInvitation,
  useWithdrawInvitation,
} from "../../lib/friend-queries";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { InviteFriendDialog } from "./invite-friend-dialog";

/**
 * Friends, reached from the profile menu. Friends belong to the account,
 * not to a workspace: the requests waiting for an answer, the friends by
 * name, and what was sent and still waits (a request to an account or an
 * invitation to an address, told apart only by whether it expires). Every
 * action answers at once; the list reads again after it.
 */
export function FriendsPage() {
  const t = useTranslations("friends");
  const friends = useFriendsQuery();
  const [inviting, setInviting] = useState(false);
  const { locale, instant } = useDisplayPreferences();
  const accept = useAcceptFriendRequest();
  const decline = useDeclineFriendRequest();
  const withdraw = useWithdrawInvitation();
  const resend = useResendInvitation();
  const remove = useRemoveFriend();
  const busy =
    accept.isPending ||
    decline.isPending ||
    withdraw.isPending ||
    resend.isPending ||
    remove.isPending;
  const failure = [accept, decline, withdraw, resend, remove].find(
    (mutation) => mutation.isError,
  );
  const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      ...(instant.timeZone !== undefined && { timeZone: instant.timeZone }),
    }).format(new Date(iso));
  return (
    <main className="workspace-page friends-page" tabIndex={-1}>
      <header className="page-heading split-heading">
        <div>
          <h1>{t("title")}</h1>
        </div>
        <button
          aria-haspopup="dialog"
          className="button button-primary"
          onClick={() => setInviting(true)}
          type="button"
        >
          <UserPlusIcon />
          {t("invite")}
        </button>
      </header>
      {inviting ? (
        <InviteFriendDialog onClose={() => setInviting(false)} />
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
            <section
              aria-labelledby="friend-requests"
              className="friends-group"
            >
              <h2 id="friend-requests">
                {t("requests")}{" "}
                <span className="friends-count">
                  {friends.data.incoming.length}
                </span>
              </h2>
              <ul className="friends-list">
                {friends.data.incoming.map((request) => (
                  <li className="friends-row friends-request" key={request.id}>
                    <span aria-hidden="true" className="friend-mark">
                      {initials(request.requester.displayName)}
                    </span>
                    <div className="friends-row-body">
                      <p>
                        <strong>{request.requester.displayName}</strong>
                        <span className="friends-meta">
                          {request.requester.email ?? ""}
                        </span>
                      </p>
                      {request.message !== null ? (
                        <blockquote className="friends-note">
                          {request.message}
                        </blockquote>
                      ) : null}
                      <div className="friends-actions">
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
          <section aria-labelledby="friend-list" className="friends-group">
            <h2 id="friend-list">
              {t("friends")}{" "}
              <span className="friends-count">
                {friends.data.friends.length}
              </span>
            </h2>
            {friends.data.friends.length === 0 ? (
              <p className="friends-empty">{t("noFriends")}</p>
            ) : (
              <ul className="friends-list">
                {friends.data.friends.map((friend) => (
                  <li className="friends-row" key={friend.id}>
                    <span
                      aria-hidden="true"
                      className="friend-mark friend-mark-linked"
                    >
                      {initials(friend.displayName)}
                    </span>
                    <div className="friends-row-body">
                      <p>
                        <strong>{friend.displayName}</strong>
                        <span className="friends-meta">
                          {friend.email ?? ""}
                        </span>
                      </p>
                    </div>
                    <span className="friends-since">
                      {t("since", { date: day(friend.since) })}
                    </span>
                    <button
                      className="button button-quiet button-small"
                      disabled={busy}
                      onClick={() => remove.mutate(friend.id)}
                      type="button"
                    >
                      {t("remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {friends.data.sent.length > 0 ? (
            <section aria-labelledby="friend-sent" className="friends-group">
              <h2 id="friend-sent">
                {t("sent")}{" "}
                <span className="friends-count">
                  {friends.data.sent.length}
                </span>
              </h2>
              <ul className="friends-list">
                {friends.data.sent.map((item) => (
                  <li className="friends-row" key={item.id}>
                    <span aria-hidden="true" className="friend-mark">
                      {initials(item.email)}
                    </span>
                    <div className="friends-row-body">
                      <p>
                        <strong>{item.email}</strong>
                        <span className="friends-meta">
                          {item.expiresAt === null
                            ? t("sentOn", { date: day(item.createdAt) })
                            : t("linkUntil", { date: day(item.expiresAt) })}
                        </span>
                      </p>
                    </div>
                    <button
                      className="button button-quiet button-small"
                      disabled={busy}
                      onClick={() => resend.mutate(item.id)}
                      type="button"
                    >
                      {t("resend")}
                    </button>
                    <button
                      className="button button-quiet button-small"
                      disabled={busy}
                      onClick={() => withdraw.mutate(item.id)}
                      type="button"
                    >
                      {t("withdraw")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

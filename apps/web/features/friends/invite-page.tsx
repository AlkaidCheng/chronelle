"use client";

import type { InvitationAcceptResponse } from "@livtales/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { CheckIcon } from "../../components/icons";
import { rememberAfterSignIn } from "../../lib/after-sign-in";
import { useAuthSession } from "../../lib/auth-session";
import {
  useAcceptInvitation,
  useInvitationPeekQuery,
} from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import { useSessionQuery } from "../../lib/queries";
import { useDisplayPreferences } from "../../lib/use-display-preferences";

/**
 * The page an invitation link opens. Anyone with the link sees who
 * invited them, the note, and what they will be able to see; signed out,
 * it offers Sign in and Create an account, both returning here; signed
 * in, it names the account and offers Accept or Not now. Nothing happens
 * without Accept. Accepting names what became shared and what the account
 * already had; a link that is the account's own, used, withdrawn, or
 * expired says so. A new account completes the Welcome step first.
 */
export function InvitePage({ token }: { readonly token: string }) {
  const t = useTranslations("invite");
  const roles = useTranslations("access");
  const auth = useAuthSession();
  const router = useRouter();
  const { locale, instant } = useDisplayPreferences();
  const signedIn = auth.credential !== null;
  const session = useSessionQuery();
  const peek = useInvitationPeekQuery(token);
  const accept = useAcceptInvitation();
  const [accepted, setAccepted] = useState<InvitationAcceptResponse | null>(
    null,
  );
  const me = session.data?.user;
  const invitation = peek.data;
  const path = `/invite/${token}`;
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(instant.timeZone !== undefined && { timeZone: instant.timeZone }),
    }).format(new Date(iso));

  // A new account completes the Welcome step, which returns here.
  const onboarded = me?.onboardedAt;
  useEffect(() => {
    if (onboarded === null) {
      rememberAfterSignIn(path);
      router.replace("/welcome");
    }
  }, [onboarded, path, router]);

  function signIn() {
    rememberAfterSignIn(path);
    router.push("/sign-in");
  }

  function createAccount() {
    rememberAfterSignIn(path);
    router.push(`/sign-up?invitation=${encodeURIComponent(token)}`);
  }

  function switchAccount() {
    rememberAfterSignIn(path);
    auth.signOut();
    router.push("/sign-in");
  }

  const open = (
    <Link className="button button-primary" href="/events">
      {t("openChronelle")}
    </Link>
  );

  let body: ReactNode;
  if (!auth.isHydrated || peek.isPending) {
    body = <LoadingState label={t("loading")} />;
  } else if (peek.isError || invitation === undefined) {
    body = (
      <>
        <p className="code-note">{t("unavailable")}</p>
        <div className="form-actions">{open}</div>
      </>
    );
  } else if (accepted !== null) {
    body = (
      <>
        <p className="code-note code-note-ok" role="status">
          <CheckIcon className="code-note-check" />
          {accepted.friendship === "made"
            ? t("nowFriends", { name: invitation.requester.displayName })
            : t("alreadyFriendsNote")}
        </p>
        {accepted.shared.length + accepted.alreadyHad.length > 0 ? (
          <ul className="invite-records">
            {accepted.shared.map((record) => (
              <li key={record.resourceId}>
                {t("sharedWithYou", {
                  record: record.displayName,
                  role: roles(`roles.${record.role}`),
                })}
              </li>
            ))}
            {accepted.alreadyHad.map((record) => (
              <li className="invite-record-had" key={record.resourceId}>
                {t("alreadyHad", { record: record.displayName })}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="form-actions">{open}</div>
      </>
    );
  } else if (invitation.status !== "open") {
    body = (
      <>
        <p className="code-note" role="status">
          {invitation.status === "used"
            ? t("linkUsed")
            : invitation.status === "expired"
              ? t("linkExpired", { date: day(invitation.expiresAt) })
              : t("linkEnded")}
        </p>
        <div className="form-actions">
          {signedIn ? (
            open
          ) : (
            <button
              className="button button-primary"
              onClick={signIn}
              type="button"
            >
              {t("signIn")}
            </button>
          )}
        </div>
      </>
    );
  } else {
    const own =
      me !== undefined && me.username === invitation.requester.username;
    body = (
      <>
        <div className="code-account">
          <span aria-hidden="true" className="person-avatar person-avatar-page">
            {personInitials(invitation.requester.displayName)}
          </span>
          <div className="code-account-names">
            <h1 className="code-account-title">
              {t("invitedYou", { name: invitation.requester.displayName })}
            </h1>
            <p className="code-account-handle">
              @{invitation.requester.username}
            </p>
          </div>
        </div>
        {invitation.message === null ? null : (
          <blockquote className="invite-note">{invitation.message}</blockquote>
        )}
        {invitation.queued.length > 0 ? (
          <div className="invite-queued">
            <p className="code-note">{t("willShare")}</p>
            <ul className="invite-records">
              {invitation.queued.map((record) => (
                <li key={record.resourceId}>
                  {t("queuedAs", {
                    record: record.displayName,
                    role: roles(`roles.${record.role}`),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!signedIn ? (
          <>
            <p className="code-note">{t("signInToAccept")}</p>
            <div className="form-actions">
              <button
                className="button button-quiet"
                onClick={createAccount}
                type="button"
              >
                {t("createAccount")}
              </button>
              <button
                className="button button-primary"
                onClick={signIn}
                type="button"
              >
                {t("signIn")}
              </button>
            </div>
          </>
        ) : me === undefined ? (
          <LoadingState label={t("loading")} />
        ) : (
          <>
            <div className="code-signed">
              <span
                aria-hidden="true"
                className="person-avatar person-avatar-mini"
              >
                {personInitials(me.displayName)}
              </span>
              <span className="code-signed-who">
                <strong>{t("signedInAs", { name: me.displayName })}</strong>
                <span className="code-signed-handle">@{me.username}</span>
              </span>
              <button
                className="link-button"
                onClick={switchAccount}
                type="button"
              >
                {t("notYou")}
              </button>
            </div>
            {accept.isError ? <ErrorNotice error={accept.error} /> : null}
            {own ? (
              <>
                <p className="code-note" role="status">
                  {t("ownLink")}
                </p>
                <div className="form-actions">{open}</div>
              </>
            ) : (
              <div className="form-actions">
                <Link className="button button-quiet" href="/events">
                  {t("notNow")}
                </Link>
                <button
                  className="button button-primary"
                  disabled={accept.isPending}
                  onClick={() =>
                    accept.mutate(token, { onSuccess: setAccepted })
                  }
                  type="button"
                >
                  {accept.isPending ? t("accepting") : t("accept")}
                </button>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <AccountPage>
      <section className="account-card invite-card">{body}</section>
    </AccountPage>
  );
}

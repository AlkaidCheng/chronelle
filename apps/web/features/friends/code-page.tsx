"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { BrandLogo } from "../../components/brand-logo";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { CheckIcon, UserPlusIcon } from "../../components/icons";
import { LocaleMenu } from "../../components/locale-menu";
import { rememberAfterSignIn } from "../../lib/after-sign-in";
import { useAuthSession } from "../../lib/auth-session";
import { useRequestFriend, useUserLookupQuery } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import { useSessionQuery } from "../../lib/queries";

/**
 * The page a profile code opens: the account behind the username, and Add
 * friend, or how the two already stand. Signed out, it asks for a sign-in
 * first and returns here after it; the account's name is shown only to a
 * signed-in viewer.
 */
export function CodePage({ username }: { readonly username: string }) {
  const t = useTranslations("code");
  const auth = useAuthSession();
  const router = useRouter();
  const signedIn = auth.credential !== null;
  const session = useSessionQuery();
  const lookup = useUserLookupQuery(username, signedIn);
  const request = useRequestFriend();
  const [sent, setSent] = useState(false);
  const me = session.data?.user;
  const account = lookup.data;
  const relation = sent ? "requested" : account?.relation;

  function signIn() {
    rememberAfterSignIn(`/u/${username}`);
    router.push("/sign-in");
  }

  let body: ReactNode;
  if (!auth.isHydrated) body = null;
  else if (!signedIn)
    body = (
      <>
        <p className="code-note">{t("signInFirst")}</p>
        <div className="form-actions">
          <button
            className="button button-primary"
            onClick={signIn}
            type="button"
          >
            {t("signIn")}
          </button>
        </div>
      </>
    );
  else if (lookup.isPending) body = <LoadingState label={t("loading")} />;
  else if (lookup.isError || account === undefined)
    body = (
      <>
        <p className="code-note">{t("unavailable")}</p>
        <div className="form-actions">
          <Link className="button button-primary" href="/events">
            {t("openChronelle")}
          </Link>
        </div>
      </>
    );
  else
    body = (
      <>
        <div className="code-account">
          <span aria-hidden="true" className="person-avatar person-avatar-page">
            {personInitials(account.displayName)}
          </span>
          <div className="code-account-names">
            <h1 className="code-account-title">{account.displayName}</h1>
            <p className="code-account-handle">@{account.username}</p>
          </div>
        </div>
        {me !== undefined ? (
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
              onClick={() => auth.signOut()}
              type="button"
            >
              {t("notYou")}
            </button>
          </div>
        ) : null}
        {request.isError ? <ErrorNotice error={request.error} /> : null}
        {account.id === me?.id ? (
          <p className="code-note" role="status">
            {t("yourself")}
          </p>
        ) : relation === "friend" ? (
          <p className="code-note code-note-ok" role="status">
            <CheckIcon className="code-note-check" />
            {t("alreadyFriends")}
          </p>
        ) : relation === "requested" ? (
          <p className="code-note code-note-ok" role="status">
            <CheckIcon className="code-note-check" />
            {t("requestSent")}
          </p>
        ) : relation === "incoming" ? (
          <p className="code-note" role="status">
            {t("wantsYou", { name: account.displayName })}
          </p>
        ) : null}
        <div className="form-actions">
          {relation === "incoming" ? (
            <Link className="button button-primary" href="/friends">
              {t("openFriends")}
            </Link>
          ) : relation === "none" && account.id !== me?.id ? (
            <button
              className="button button-primary"
              disabled={request.isPending}
              onClick={() =>
                request.mutate(
                  { userId: account.id },
                  { onSuccess: () => setSent(true) },
                )
              }
              type="button"
            >
              <UserPlusIcon />
              {request.isPending ? t("adding") : t("addFriend")}
            </button>
          ) : (
            <Link className="button button-primary" href="/events">
              {t("openChronelle")}
            </Link>
          )}
        </div>
      </>
    );

  return (
    <main className="code-page">
      <section className="code-card">
        <a className="brand code-brand" href="/events">
          <BrandLogo />
        </a>
        {body}
        <div className="code-language">
          <LocaleMenu />
        </div>
      </section>
    </main>
  );
}

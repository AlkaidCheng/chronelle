"use client";

import { ApiClientError } from "@livtales/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { ErrorNotice } from "../../components/feedback";
import {
  usePasswordSignIn,
  useRedirectWhenSignedIn,
} from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

/** Sign in with the username or the email of the account and its password. */
export default function SignInPage() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const router = useRouter();
  const signIn = usePasswordSignIn();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const passwordId = useId();
  useRedirectWhenSignedIn();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate(
      { login, password },
      {
        onError: (error) => {
          // The address is registered but not yet verified; a fresh code was
          // just sent, so the code screen is the next step.
          if (
            error instanceof ApiClientError &&
            error.code === "email_unverified"
          )
            router.push(
              login.includes("@")
                ? `/verify-email?email=${encodeURIComponent(login)}`
                : "/verify-email",
            );
        },
      },
    );
  }

  return (
    <AccountPage>
      <form className="account-card" onSubmit={handleSubmit}>
        <h1 className="account-title">{t("signIn.title")}</h1>
        <label className="field">
          <span>{t("signIn.login")}</span>
          <input
            autoCapitalize="none"
            autoComplete="username"
            disabled={!auth.isHydrated}
            onChange={(event) => setLogin(event.target.value)}
            required
            value={login}
          />
        </label>
        <div className="field">
          <span className="field-head">
            <label htmlFor={passwordId}>{t("password")}</label>
            <Link className="field-head-link" href="/reset-password">
              {t("signIn.forgot")}
            </Link>
          </span>
          <input
            autoComplete="current-password"
            disabled={!auth.isHydrated}
            id={passwordId}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </div>
        {signIn.isError ? <ErrorNotice error={signIn.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || signIn.isPending}
          type="submit"
        >
          {signIn.isPending ? t("signIn.pending") : t("signIn.submit")}
        </button>
      </form>
      <p className="account-aside">
        {t("signIn.new")}{" "}
        <Link className="account-aside-link" href="/sign-up">
          {t("signIn.createAccount")}
        </Link>
      </p>
    </AccountPage>
  );
}

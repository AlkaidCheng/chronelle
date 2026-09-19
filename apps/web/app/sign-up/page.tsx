"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, Suspense, useEffect, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { ErrorNotice } from "../../components/feedback";
import { useRedirectWhenSignedIn, useSignUp } from "../../lib/account-queries";
import { rememberAfterSignIn } from "../../lib/after-sign-in";
import { useAuthSession } from "../../lib/auth-session";
import { useUsernameAvailableQuery } from "../../lib/friend-queries";
import { usernameShape } from "../../lib/username";

/**
 * Create an account: the email, the password, and the username, whose
 * availability is checked as typed. The name and the display preferences
 * are asked on the Welcome step after the email is confirmed. Opened from
 * an invitation link, the sign-up carries the token and returns to the
 * link's page after Welcome, where Accept is explicit.
 */
function SignUpForm() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const router = useRouter();
  const parameters = useSearchParams();
  const invitationToken = parameters.get("invitation");
  const signUp = useSignUp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(username), 250);
    return () => window.clearTimeout(timer);
  }, [username]);
  const wellFormed = usernameShape.test(debounced);
  const availability = useUsernameAvailableQuery(debounced, wellFormed);
  const usernameState =
    debounced === ""
      ? null
      : !wellFormed
        ? "invalid"
        : availability.data === undefined
          ? null
          : availability.data.available
            ? "available"
            : "taken";
  useRedirectWhenSignedIn();
  useEffect(() => {
    if (invitationToken !== null)
      rememberAfterSignIn(`/invite/${invitationToken}`);
  }, [invitationToken]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usernameShape.test(username)) return;
    signUp.mutate(
      {
        email,
        password,
        username,
        ...(invitationToken !== null && { invitationToken }),
      },
      {
        onSuccess: () =>
          router.push(`/verify-email?email=${encodeURIComponent(email)}`),
      },
    );
  }

  return (
    <AccountPage>
      <form className="account-card" onSubmit={handleSubmit}>
        <h1 className="account-title">{t("signUp.title")}</h1>
        <label className="field">
          <span>{t("email")}</span>
          <input
            autoComplete="email"
            disabled={!auth.isHydrated}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <div className="account-field">
          <label className="field">
            <span>{t("password")}</span>
            <input
              aria-describedby="sign-up-password-hint"
              autoComplete="new-password"
              disabled={!auth.isHydrated}
              maxLength={256}
              minLength={10}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <small className="account-field-hint" id="sign-up-password-hint">
            {t("signUp.passwordHint")}
          </small>
        </div>
        <div className="account-field">
          <label className="field">
            <span>{t("username")}</span>
            <span className="username-input">
              <span aria-hidden="true" className="username-at">
                @
              </span>
              <input
                aria-describedby="sign-up-username-hint"
                autoCapitalize="none"
                autoComplete="username"
                className="username-field"
                disabled={!auth.isHydrated}
                maxLength={30}
                onChange={(event) => setUsername(event.target.value.trim())}
                pattern="[A-Za-z][A-Za-z0-9_-]{2,29}"
                required
                value={username}
              />
            </span>
          </label>
          <p
            className={`username-availability username-availability-${usernameState ?? "none"}`}
            role="status"
          >
            {usernameState === null
              ? ""
              : usernameState === "available"
                ? t("signUp.usernameAvailable", { username: debounced })
                : usernameState === "taken"
                  ? t("signUp.usernameTaken", { username: debounced })
                  : t("signUp.usernameInvalid")}
          </p>
          <small className="account-field-hint" id="sign-up-username-hint">
            {t("signUp.usernameHint")}
          </small>
        </div>
        {signUp.isError ? <ErrorNotice error={signUp.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || signUp.isPending}
          type="submit"
        >
          {signUp.isPending ? t("signUp.pending") : t("signUp.submit")}
        </button>
        <p className="account-fine">{t("signUp.fine")}</p>
      </form>
      <p className="account-aside">
        {t("signUp.haveAccount")}{" "}
        <Link className="account-aside-link" href="/sign-in">
          {t("signUp.signIn")}
        </Link>
      </p>
    </AccountPage>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

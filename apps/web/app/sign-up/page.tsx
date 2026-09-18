"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, Suspense, useEffect, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { AppearanceSettings } from "../../components/appearance-settings";
import { ErrorNotice } from "../../components/feedback";
import { useRedirectWhenSignedIn, useSignUp } from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";
import { useUsernameAvailableQuery } from "../../lib/friend-queries";
import { suggestUsername, usernameShape } from "../../lib/username";

function SignUpForm() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const router = useRouter();
  const parameters = useSearchParams();
  const invitationToken = parameters.get("invitation");
  const signUp = useSignUp();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The username follows the name until it is edited by hand.
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
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

  function chooseName(next: string) {
    setDisplayName(next);
    if (!usernameTouched)
      setUsername(next.trim() === "" ? "" : suggestUsername(next));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!usernameShape.test(username)) return;
    signUp.mutate(
      {
        displayName,
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
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <AppearanceSettings />
        <div>
          <p className="eyebrow">{t("signUp.eyebrow")}</p>
          <h2>{t("signUp.title")}</h2>
          <p className="form-intro">{t("signUp.intro")}</p>
        </div>
        <label className="field">
          <span>{t("name")}</span>
          <input
            autoComplete="name"
            disabled={!auth.isHydrated}
            maxLength={120}
            onChange={(event) => chooseName(event.target.value)}
            required
            value={displayName}
          />
        </label>
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
              onChange={(event) => {
                setUsernameTouched(true);
                setUsername(event.target.value.trim());
              }}
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
            : t(
                usernameState === "available"
                  ? "usernameAvailable"
                  : usernameState === "taken"
                    ? "usernameTaken"
                    : "usernameInvalid",
              )}
        </p>
        <small className="field-hint" id="sign-up-username-hint">
          {t("usernameHint")}
        </small>
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
        <small className="field-hint" id="sign-up-password-hint">
          {t("passwordHint")}
        </small>
        {signUp.isError ? <ErrorNotice error={signUp.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || signUp.isPending}
          type="submit"
        >
          {signUp.isPending ? t("signUp.pending") : t("signUp.submit")}
        </button>
        <p className="form-links">
          <Link href="/sign-in">{t("signUp.haveAccount")}</Link>
        </p>
      </form>
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

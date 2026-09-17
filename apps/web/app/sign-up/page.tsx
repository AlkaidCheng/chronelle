"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { AppearanceSettings } from "../../components/appearance-settings";
import { ErrorNotice } from "../../components/feedback";
import { useRedirectWhenSignedIn, useSignUp } from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

export default function SignUpPage() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const router = useRouter();
  const signUp = useSignUp();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useRedirectWhenSignedIn();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signUp.mutate(
      { displayName, email, password },
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
            onChange={(event) => setDisplayName(event.target.value)}
            required
            value={displayName}
          />
        </label>
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

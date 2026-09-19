"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, Suspense, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { ErrorNotice } from "../../components/feedback";
import {
  useRedirectWhenSignedIn,
  useResendVerification,
  useVerifyEmail,
} from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

/**
 * The code step: the six digits sent to the address the link carried, or
 * to the address typed here when the screen was opened by hand.
 */
function VerifyEmailForm() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const parameters = useSearchParams();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const known = parameters.get("email");
  const [email, setEmail] = useState(known ?? "");
  const [code, setCode] = useState("");
  useRedirectWhenSignedIn();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    verify.mutate({ email, code });
  }

  return (
    <AccountPage>
      <form className="account-card" onSubmit={handleSubmit}>
        <h1 className="account-title">{t("verify.title")}</h1>
        <p className="account-intro">
          {known === null
            ? t("verify.introNoEmail")
            : t("verify.intro", { email: known })}
        </p>
        {known === null ? (
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
        ) : null}
        <label className="field">
          <span>{t("verify.code")}</span>
          <input
            autoComplete="one-time-code"
            className="account-code-input"
            disabled={!auth.isHydrated}
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setCode(event.target.value)}
            pattern="[0-9]{6}"
            required
            value={code}
          />
        </label>
        {verify.isError ? <ErrorNotice error={verify.error} /> : null}
        {resend.isError ? <ErrorNotice error={resend.error} /> : null}
        {resend.isSuccess ? (
          <p className="account-hint" role="status">
            {t("verify.resent")}
          </p>
        ) : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || verify.isPending}
          type="submit"
        >
          {verify.isPending ? t("verify.pending") : t("verify.submit")}
        </button>
        <p className="account-links">
          <button
            className="account-link"
            disabled={
              !auth.isHydrated || resend.isPending || email.length === 0
            }
            onClick={() => resend.mutate({ email })}
            type="button"
          >
            {t("verify.resend")}
          </button>
          <Link className="account-link" href="/sign-in">
            {t("backToSignIn")}
          </Link>
        </p>
      </form>
    </AccountPage>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}

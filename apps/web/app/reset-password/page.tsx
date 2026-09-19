"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { ErrorNotice } from "../../components/feedback";
import {
  useConfirmPasswordReset,
  useRedirectWhenSignedIn,
  useRequestPasswordReset,
} from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

/**
 * Account recovery: the email first; once a code is requested, the code and
 * the new password for that address.
 */
export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const request = useRequestPasswordReset();
  const confirm = useConfirmPasswordReset();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  useRedirectWhenSignedIn();

  // Requesting a code answers the same way whether or not the address has an
  // account, so the code step follows any accepted request.
  const codeStep = request.isSuccess;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codeStep) confirm.mutate({ email, code, password });
    else request.mutate({ email });
  }

  return (
    <AccountPage>
      <form className="account-card" onSubmit={handleSubmit}>
        <h1 className="account-title">{t("reset.title")}</h1>
        <p className="account-intro">
          {codeStep ? t("reset.introCode", { email }) : t("reset.introEmail")}
        </p>
        {codeStep ? (
          <>
            <label className="field">
              <span>{t("reset.code")}</span>
              <input
                autoComplete="one-time-code"
                className="account-code-input"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value)}
                pattern="[0-9]{6}"
                required
                value={code}
              />
            </label>
            <div className="account-field">
              <label className="field">
                <span>{t("reset.newPassword")}</span>
                <input
                  aria-describedby="reset-password-hint"
                  autoComplete="new-password"
                  maxLength={256}
                  minLength={10}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <small className="account-field-hint" id="reset-password-hint">
                {t("signUp.passwordHint")}
              </small>
            </div>
          </>
        ) : (
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
        )}
        {request.isError ? <ErrorNotice error={request.error} /> : null}
        {confirm.isError ? <ErrorNotice error={confirm.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || request.isPending || confirm.isPending}
          type="submit"
        >
          {codeStep
            ? confirm.isPending
              ? t("reset.updating")
              : t("reset.setPassword")
            : request.isPending
              ? t("reset.sending")
              : t("reset.sendCode")}
        </button>
        <p className="account-links">
          <Link className="account-link" href="/sign-in">
            {t("backToSignIn")}
          </Link>
        </p>
      </form>
    </AccountPage>
  );
}

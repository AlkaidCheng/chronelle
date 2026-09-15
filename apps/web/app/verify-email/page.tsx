"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { AppearanceSettings } from "../../components/appearance-settings";
import { ErrorNotice } from "../../components/feedback";
import {
  useRedirectWhenSignedIn,
  useResendVerification,
  useVerifyEmail,
} from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

function VerifyEmailForm() {
  const auth = useAuthSession();
  const parameters = useSearchParams();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const [email, setEmail] = useState(parameters.get("email") ?? "");
  const [code, setCode] = useState("");
  useRedirectWhenSignedIn();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    verify.mutate({ email, code });
  }

  return (
    <AccountPage>
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <AppearanceSettings />
        <div>
          <p className="eyebrow">One more step</p>
          <h2>Confirm your email</h2>
          <p className="form-intro">
            Enter the six-digit code from the email we sent. It expires after
            fifteen minutes.
          </p>
        </div>
        <label className="field">
          <span>Email</span>
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
          <span>Verification code</span>
          <input
            autoComplete="one-time-code"
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
          <p className="form-note" role="status">
            A new code is on its way if this address has an unverified account.
          </p>
        ) : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || verify.isPending}
          type="submit"
        >
          {verify.isPending ? "Confirming..." : "Confirm"}
        </button>
        <button
          className="button button-secondary button-wide"
          disabled={!auth.isHydrated || resend.isPending || email.length === 0}
          onClick={() => resend.mutate({ email })}
          type="button"
        >
          Send a new code
        </button>
        <p className="form-links">
          <Link href="/sign-in">Back to sign in</Link>
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

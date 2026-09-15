"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { AppearanceSettings } from "../../components/appearance-settings";
import { ErrorNotice } from "../../components/feedback";
import {
  useConfirmPasswordReset,
  useRedirectWhenSignedIn,
  useRequestPasswordReset,
} from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

export default function ResetPasswordPage() {
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
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <AppearanceSettings />
        <div>
          <p className="eyebrow">Account recovery</p>
          <h2>Reset your password</h2>
          <p className="form-intro">
            {codeStep
              ? "Enter the six-digit code from the email and choose a new password. Every other session of the account is signed out."
              : "Enter the email of your account and we send a code to reset the password."}
          </p>
        </div>
        <label className="field">
          <span>Email</span>
          <input
            autoComplete="email"
            disabled={!auth.isHydrated || codeStep}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        {codeStep ? (
          <>
            <label className="field">
              <span>Reset code</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value)}
                pattern="[0-9]{6}"
                required
                value={code}
              />
            </label>
            <label className="field">
              <span>New password</span>
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
            <small className="field-hint" id="reset-password-hint">
              At least 10 characters.
            </small>
          </>
        ) : null}
        {request.isError ? <ErrorNotice error={request.error} /> : null}
        {confirm.isError ? <ErrorNotice error={confirm.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || request.isPending || confirm.isPending}
          type="submit"
        >
          {codeStep
            ? confirm.isPending
              ? "Updating password..."
              : "Set new password"
            : request.isPending
              ? "Sending code..."
              : "Send reset code"}
        </button>
        <p className="form-links">
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </form>
    </AccountPage>
  );
}

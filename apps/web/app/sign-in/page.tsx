"use client";

import { ApiClientError } from "@chronelle/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { AppearanceSettings } from "../../components/appearance-settings";
import { ErrorNotice } from "../../components/feedback";
import {
  usePasswordSignIn,
  useRedirectWhenSignedIn,
} from "../../lib/account-queries";
import { useAuthSession } from "../../lib/auth-session";

export default function SignInPage() {
  const auth = useAuthSession();
  const router = useRouter();
  const signIn = usePasswordSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useRedirectWhenSignedIn();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate(
      { email, password },
      {
        onError: (error) => {
          // The address is registered but not yet verified; a fresh code was
          // just sent, so the code screen is the next step.
          if (
            error instanceof ApiClientError &&
            error.code === "email_unverified"
          )
            router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        },
      },
    );
  }

  return (
    <AccountPage>
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <AppearanceSettings />
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in</h2>
          <p className="form-intro">
            Use the email and password of your Chronelle account.
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
          <span>Password</span>
          <input
            autoComplete="current-password"
            disabled={!auth.isHydrated}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {signIn.isError ? <ErrorNotice error={signIn.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || signIn.isPending}
          type="submit"
        >
          {signIn.isPending ? "Signing in..." : "Sign in"}
        </button>
        <p className="form-links">
          <Link href="/sign-up">Create an account</Link>
          <Link href="/reset-password">Forgot your password?</Link>
        </p>
      </form>
    </AccountPage>
  );
}

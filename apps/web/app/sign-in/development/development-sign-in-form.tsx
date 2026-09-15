"use client";

import { type FormEvent, useState } from "react";

import { AccountPage } from "../../../components/account-page";
import { AppearanceSettings } from "../../../components/appearance-settings";
import { ErrorNotice } from "../../../components/feedback";
import { useRedirectWhenSignedIn } from "../../../lib/account-queries";
import { useAuthSession } from "../../../lib/auth-session";
import { useDevelopmentSignIn } from "../../../lib/queries";

export function DevelopmentSignInForm() {
  const auth = useAuthSession();
  const signIn = useDevelopmentSignIn();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  useRedirectWhenSignedIn();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate({ displayName, email });
  }

  return (
    <AccountPage footnote="Development access">
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <AppearanceSettings />
        <div>
          <span className="preview-label">Development preview</span>
          <p className="eyebrow">Welcome to Chronelle</p>
          <h2>Open your workspace</h2>
          <p className="form-intro">
            Try your planning workspace with a test name and email. Use the same
            email to return to your plans.
          </p>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            autoComplete="name"
            disabled={!auth.isHydrated}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Alex Morgan"
            required
            value={displayName}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            autoComplete="email"
            disabled={!auth.isHydrated}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alex@example.com"
            required
            type="email"
            value={email}
          />
        </label>
        {signIn.isError ? <ErrorNotice error={signIn.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={!auth.isHydrated || signIn.isPending}
          type="submit"
        >
          {signIn.isPending ? "Opening workspace..." : "Continue"}
        </button>
        <p className="privacy-note">
          For trusted testing only. Email ownership is not verified, so anyone
          with an email can access that development identity. Do not use real
          personal data.
        </p>
      </form>
    </AccountPage>
  );
}

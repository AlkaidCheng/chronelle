"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { useAuthSession } from "../../lib/auth-session";
import { useDevelopmentSignIn } from "../../lib/queries";

export default function SignInPage() {
  const auth = useAuthSession();
  const router = useRouter();
  const signIn = useDevelopmentSignIn();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (auth.isHydrated && auth.credential !== null) {
      router.replace("/events");
    }
  }, [auth.credential, auth.isHydrated, router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate(
      { displayName, email },
      { onSuccess: () => router.push("/events") },
    );
  }

  return (
    <main className="sign-in-page">
      <section className="sign-in-intro">
        <a className="brand brand-light" href="/sign-in">
          <span className="brand-mark">C</span>
          <span>Chronelle</span>
        </a>
        <div>
          <p className="eyebrow eyebrow-light">Life, thoughtfully connected</p>
          <h1>Make every plan part of your story.</h1>
          <p>
            Bring schedules, work, costs, and timely reminders together around
            one canonical event.
          </p>
        </div>
        <p className="sign-in-footnote">Development access</p>
      </section>
      <section className="sign-in-form-wrap">
        <form className="sign-in-form" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Welcome to Chronelle</p>
            <h2>Open your workspace</h2>
            <p className="form-intro">
              Enter a development identity. Chronelle will create or reopen its
              personal workspace.
            </p>
          </div>
          <label className="field">
            <span>Name</span>
            <input
              autoComplete="name"
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
            This local adapter uses an expiring in-memory session. It is not a
            production identity provider.
          </p>
        </form>
      </section>
    </main>
  );
}

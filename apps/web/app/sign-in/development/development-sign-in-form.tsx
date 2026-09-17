"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { AccountPage } from "../../../components/account-page";
import { AppearanceSettings } from "../../../components/appearance-settings";
import { ErrorNotice } from "../../../components/feedback";
import { useRedirectWhenSignedIn } from "../../../lib/account-queries";
import { useAuthSession } from "../../../lib/auth-session";
import { useDevelopmentSignIn } from "../../../lib/queries";

export function DevelopmentSignInForm() {
  const t = useTranslations("auth");
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
    <AccountPage footnote={t("development.footnote")}>
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <AppearanceSettings />
        <div>
          <span className="preview-label">{t("development.preview")}</span>
          <p className="eyebrow">{t("development.eyebrow")}</p>
          <h2>{t("development.title")}</h2>
          <p className="form-intro">{t("development.intro")}</p>
        </div>
        <label className="field">
          <span>{t("name")}</span>
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
          <span>{t("email")}</span>
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
          {signIn.isPending
            ? t("development.pending")
            : t("development.continue")}
        </button>
        <p className="privacy-note">{t("development.privacy")}</p>
      </form>
    </AccountPage>
  );
}

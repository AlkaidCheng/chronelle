"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";

import { AccountPage } from "../../components/account-page";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import type { HourCycle } from "../../i18n/active-preferences";
import { isLocale, type LocaleChoice } from "../../i18n/locale-preference";
import { locales } from "../../i18n/locales";
import { takeAfterSignIn } from "../../lib/after-sign-in";
import { useAuthSession } from "../../lib/auth-session";
import { useUpdateAccount } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import {
  useAdoptAccountLocale,
  useSessionQuery,
  useUpdatePreferences,
} from "../../lib/queries";
import { TimeZoneField } from "../settings/language-time-settings";

/**
 * The Welcome step, once, after the first sign-in of a new account: the
 * name, the language, the time zone, and the clock, then the workspace.
 * The time zone and clock start as the device's; every value can be
 * changed later in Settings. Continue goes on to the page that was waiting
 * on the sign-in (an invitation link), else the workspace; an account past
 * the step goes to the workspace; a signed-out visitor to the sign-in
 * screen.
 */
export function WelcomePage() {
  const t = useTranslations("auth");
  const auth = useAuthSession();
  const router = useRouter();
  const session = useSessionQuery();
  const active = useLocale();
  const preferences = useUpdatePreferences();
  const account = useUpdateAccount();
  const adoptLocale = useAdoptAccountLocale();
  const user = session.data?.user;
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<LocaleChoice | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [hourCycle, setHourCycle] = useState<HourCycle | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (auth.isHydrated && auth.credential === null) router.replace("/sign-in");
  }, [auth.credential, auth.isHydrated, router]);
  useEffect(() => {
    if (user !== undefined && user.onboardedAt !== null)
      router.replace("/events");
  }, [router, user]);

  const languageChoice: LocaleChoice =
    language ??
    (user?.locale !== null &&
    user?.locale !== undefined &&
    isLocale(user.locale)
      ? user.locale
      : "system");
  const activeName =
    locales.find((entry) => entry.tag === active)?.native ?? active;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (user === undefined || saving) return;
    setSaving(true);
    try {
      const locale = languageChoice === "system" ? null : languageChoice;
      const changed = {
        ...(locale !== user.locale && { locale }),
        ...(timeZone !== user.timeZone && { timeZone }),
        ...(hourCycle !== user.hourCycle && { hourCycle }),
      };
      if (Object.keys(changed).length > 0) {
        const updated = await preferences.mutateAsync(changed);
        adoptLocale(updated);
      }
      await account.mutateAsync({ displayName: name, onboarded: true });
      router.replace(takeAfterSignIn() ?? "/events");
    } catch {
      // The notice below shows the failure; the form stays for another try.
    } finally {
      setSaving(false);
    }
  }

  if (!auth.isHydrated || auth.credential === null || user === undefined) {
    return (
      <AccountPage languageMenu={false}>
        <div className="account-card">
          {session.isError ? (
            <ErrorNotice error={session.error} />
          ) : (
            <LoadingState label={t("welcome.pending")} />
          )}
        </div>
      </AccountPage>
    );
  }

  return (
    <AccountPage languageMenu={false}>
      <form className="account-card" onSubmit={handleSubmit}>
        <div className="account-who">
          <span aria-hidden="true" className="person-avatar person-avatar-card">
            {personInitials(user.username)}
          </span>
          <span className="account-who-names">
            <strong>@{user.username}</strong>
            {user.email === null ? null : <small>{user.email}</small>}
          </span>
        </div>
        <h1 className="account-title">{t("welcome.title")}</h1>
        <p className="account-intro">{t("welcome.intro")}</p>
        <label className="field">
          <span>{t("welcome.name")}</span>
          <input
            autoComplete="name"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="field">
          <span>{t("welcome.language")}</span>
          <select
            onChange={(event) => {
              const next = event.target.value;
              setLanguage(isLocale(next) ? next : "system");
            }}
            value={languageChoice}
          >
            <option value="system">
              {t("welcome.browserLanguage", { language: activeName })}
            </option>
            {locales.map((entry) => (
              <option key={entry.tag} lang={entry.tag} value={entry.tag}>
                {entry.native}
              </option>
            ))}
          </select>
        </label>
        <div className="account-row">
          <TimeZoneField compact onChange={setTimeZone} value={timeZone} />
          <label className="field">
            <span>{t("welcome.clock")}</span>
            <select
              onChange={(event) => {
                const next = event.target.value;
                setHourCycle(next === "h12" || next === "h23" ? next : null);
              }}
              value={hourCycle ?? ""}
            >
              <option value="">{t("welcome.clockFromLanguage")}</option>
              <option value="h23">{t("welcome.twentyFourHour")}</option>
              <option value="h12">{t("welcome.twelveHour")}</option>
            </select>
          </label>
        </div>
        <p className="account-hint">{t("welcome.hint")}</p>
        {preferences.isError ? <ErrorNotice error={preferences.error} /> : null}
        {account.isError ? <ErrorNotice error={account.error} /> : null}
        <button
          className="button button-primary button-wide"
          disabled={saving}
          type="submit"
        >
          {saving ? t("welcome.pending") : t("welcome.submit")}
        </button>
      </form>
    </AccountPage>
  );
}

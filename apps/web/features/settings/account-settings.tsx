"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { useUpdateAccount } from "../../lib/friend-queries";
import { useSessionQuery } from "../../lib/queries";
import { SettingRow } from "./setting-row";

/**
 * The account, a row each: the name (changeable here), the username and
 * email as the account holds them (the username was chosen at sign-up), who
 * can find the account (by username always; by name and by email as
 * switches), the password screen, and a way to end every session of the
 * account, this one included.
 */
export function AccountSettings() {
  const t = useTranslations("settings");
  const id = useId();
  const session = useSessionQuery();
  const client = useApiClient();
  const auth = useAuthSession();
  const router = useRouter();
  const account = useUpdateAccount();
  const signOutEverywhere = useMutation({
    mutationFn: () => client.signOutEverywhere(),
    onSuccess: () => {
      auth.signOut();
      router.replace("/sign-in");
    },
  });
  const user = session.data?.user;
  // The name as typed; null until edited, so a server change shows through.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? user?.displayName ?? "";
  const nameChanged =
    draft !== null && draft.trim() !== "" && draft.trim() !== user?.displayName;

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameChanged || draft === null) return;
    account.mutate(
      { displayName: draft.trim() },
      { onSuccess: () => setDraft(null) },
    );
  }

  return (
    <div className="setting-rows">
      <SettingRow label={t("displayName")} onSubmit={saveName}>
        {(control) => (
          <>
            <input
              {...control}
              autoComplete="name"
              className="setting-input"
              disabled={user === undefined || account.isPending}
              maxLength={120}
              onChange={(event) => setDraft(event.target.value)}
              required
              value={name}
            />
            <button
              className="setting-button"
              disabled={!nameChanged || account.isPending}
              type="submit"
            >
              {t("saveName")}
            </button>
          </>
        )}
      </SettingRow>
      <dl className="setting-facts">
        <div className="setting-row">
          <dt className="setting-row-text">
            <span className="setting-row-label">{t("username")}</span>
            <span className="setting-row-caption">{t("usernameNote")}</span>
          </dt>
          <dd className="setting-row-value">
            {user === undefined ? "" : `@${user.username}`}
          </dd>
        </div>
        <div className="setting-row">
          <dt className="setting-row-text">
            <span className="setting-row-label">{t("email")}</span>
          </dt>
          <dd className="setting-row-value">{user?.email ?? t("noEmail")}</dd>
        </div>
      </dl>
      <section aria-labelledby={`${id}-find`} className="setting-group">
        <h3 className="setting-group-title" id={`${id}-find`}>
          {t("whoCanFind")}
        </h3>
        <SettingRow
          caption={t("byUsernameNote", { username: user?.username ?? "" })}
          label={t("byUsername")}
        >
          {(control) => (
            <input
              {...control}
              aria-checked="true"
              checked
              className="settings-switch-input"
              disabled
              readOnly
              role="switch"
              type="checkbox"
            />
          )}
        </SettingRow>
        <SettingRow
          caption={t("byNameNote", { name: user?.displayName ?? "" })}
          label={t("byName")}
        >
          {(control) => (
            <input
              {...control}
              aria-checked={user?.findByName ?? true}
              checked={user?.findByName ?? true}
              className="settings-switch-input"
              disabled={account.isPending || user === undefined}
              onChange={(event) =>
                account.mutate({ findByName: event.target.checked })
              }
              role="switch"
              type="checkbox"
            />
          )}
        </SettingRow>
        <SettingRow
          caption={
            user?.email
              ? t("byEmailNote", { email: user.email })
              : t("byEmailNoteNone")
          }
          label={t("byEmail")}
        >
          {(control) => (
            <input
              {...control}
              aria-checked={user?.findByEmail ?? true}
              checked={user?.findByEmail ?? true}
              className="settings-switch-input"
              disabled={account.isPending || user === undefined || !user.email}
              onChange={(event) =>
                account.mutate({ findByEmail: event.target.checked })
              }
              role="switch"
              type="checkbox"
            />
          )}
        </SettingRow>
      </section>
      {account.isError ? <ErrorNotice error={account.error} /> : null}
      <SettingRow
        caption={t("passwordNote")}
        kind="action"
        label={t("password")}
      >
        {(control) => (
          <Link {...control} className="setting-button" href="/reset-password">
            {t("changePassword")}
          </Link>
        )}
      </SettingRow>
      <SettingRow
        caption={t("signOutEverywhereNote")}
        kind="action"
        label={t("sessions")}
      >
        {(control) => (
          <button
            {...control}
            className="setting-button"
            disabled={signOutEverywhere.isPending}
            onClick={() => signOutEverywhere.mutate()}
            type="button"
          >
            {t("signOutEverywhere")}
          </button>
        )}
      </SettingRow>
      {signOutEverywhere.isError ? (
        <ErrorNotice error={signOutEverywhere.error} />
      ) : null}
    </div>
  );
}

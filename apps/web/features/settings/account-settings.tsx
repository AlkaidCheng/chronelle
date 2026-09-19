"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { ErrorNotice } from "../../components/feedback";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { useUpdateAccount } from "../../lib/friend-queries";
import { useSessionQuery } from "../../lib/queries";

/**
 * The account: the name (changeable here), the username and email as the
 * account holds them (the username was chosen at sign-up), who can find
 * the account (by username always; by name and by email as switches), the
 * password screen, and a way to end every session of the account, this one
 * included.
 */
export function AccountSettings() {
  const t = useTranslations("settings");
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
    <>
      <form className="settings-name" onSubmit={saveName}>
        <label className="field settings-name-field">
          <span>{t("displayName")}</span>
          <input
            autoComplete="name"
            disabled={user === undefined || account.isPending}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            required
            value={name}
          />
        </label>
        <button
          className="button button-secondary"
          disabled={!nameChanged || account.isPending}
          type="submit"
        >
          {t("saveName")}
        </button>
      </form>
      <dl className="settings-facts">
        <div>
          <dt>{t("username")}</dt>
          <dd>{user === undefined ? "" : `@${user.username}`}</dd>
        </div>
        <div>
          <dt>{t("email")}</dt>
          <dd>{user?.email ?? t("noEmail")}</dd>
        </div>
      </dl>
      <p className="settings-note">{t("usernameNote")}</p>
      <section aria-labelledby="who-can-find" className="settings-discovery">
        <h3 className="settings-discovery-title" id="who-can-find">
          {t("whoCanFind")}
        </h3>
        <div className="settings-switch">
          <div>
            <strong className="settings-switch-title">{t("byUsername")}</strong>
            <p className="settings-switch-note">
              {t("byUsernameNote", { username: user?.username ?? "" })}
            </p>
          </div>
          <input
            aria-checked="true"
            aria-label={t("byUsername")}
            checked
            className="settings-switch-input"
            disabled
            readOnly
            role="switch"
            type="checkbox"
          />
        </div>
        <div className="settings-switch">
          <div>
            <strong className="settings-switch-title">{t("byName")}</strong>
            <p className="settings-switch-note">
              {t("byNameNote", { name: user?.displayName ?? "" })}
            </p>
          </div>
          <input
            aria-checked={user?.findByName ?? true}
            aria-label={t("byName")}
            checked={user?.findByName ?? true}
            className="settings-switch-input"
            disabled={account.isPending || user === undefined}
            onChange={(event) =>
              account.mutate({ findByName: event.target.checked })
            }
            role="switch"
            type="checkbox"
          />
        </div>
        <div className="settings-switch">
          <div>
            <strong className="settings-switch-title">{t("byEmail")}</strong>
            <p className="settings-switch-note">
              {user?.email
                ? t("byEmailNote", { email: user.email })
                : t("byEmailNoteNone")}
            </p>
          </div>
          <input
            aria-checked={user?.findByEmail ?? true}
            aria-label={t("byEmail")}
            checked={user?.findByEmail ?? true}
            className="settings-switch-input"
            disabled={account.isPending || user === undefined || !user.email}
            onChange={(event) =>
              account.mutate({ findByEmail: event.target.checked })
            }
            role="switch"
            type="checkbox"
          />
        </div>
      </section>
      {account.isError ? <ErrorNotice error={account.error} /> : null}
      <div className="settings-row">
        <div>
          <h3>{t("password")}</h3>
          <p>{t("passwordNote")}</p>
        </div>
        <Link className="button button-secondary" href="/reset-password">
          {t("changePassword")}
        </Link>
      </div>
      <div className="settings-row">
        <div>
          <h3>{t("sessions")}</h3>
          <p>{t("signOutEverywhereNote")}</p>
        </div>
        <button
          className="button button-secondary"
          disabled={signOutEverywhere.isPending}
          onClick={() => signOutEverywhere.mutate()}
          type="button"
        >
          {t("signOutEverywhere")}
        </button>
      </div>
      {signOutEverywhere.isError ? (
        <ErrorNotice error={signOutEverywhere.error} />
      ) : null}
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";

import { ErrorNotice } from "../../components/feedback";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { useSessionQuery } from "../../lib/queries";

/**
 * The account: the name and email as the account holds them (the API
 * offers no change to either), the password screen, and a way to end every
 * session of the account, this one included.
 */
export function AccountSettings() {
  const t = useTranslations("settings");
  const session = useSessionQuery();
  const client = useApiClient();
  const auth = useAuthSession();
  const router = useRouter();
  const signOutEverywhere = useMutation({
    mutationFn: () => client.signOutEverywhere(),
    onSuccess: () => {
      auth.signOut();
      router.replace("/sign-in");
    },
  });
  const user = session.data?.user;
  return (
    <>
      <dl className="settings-facts">
        <div>
          <dt>{t("displayName")}</dt>
          <dd>{user?.displayName ?? ""}</dd>
        </div>
        <div>
          <dt>{t("email")}</dt>
          <dd>{user?.email ?? t("noEmail")}</dd>
        </div>
      </dl>
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

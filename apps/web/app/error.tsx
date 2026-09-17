"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function ErrorPage({ reset }: { readonly reset: () => void }) {
  const t = useTranslations("routeState");
  return (
    <main className="route-state surface">
      <p className="eyebrow">Chronelle</p>
      <h1>{t("errorTitle")}</h1>
      <p>{t("errorText")}</p>
      <div className="form-actions">
        <button className="button button-primary" type="button" onClick={reset}>
          {t("tryAgain")}
        </button>
        <Link className="button button-secondary" href="/events">
          {t("backToEvents")}
        </Link>
      </div>
    </main>
  );
}

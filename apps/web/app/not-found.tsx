import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandLogo } from "../components/brand-logo";

export default async function NotFound() {
  const t = await getTranslations("routeState");
  return (
    <main className="route-state surface">
      <Link className="brand" href="/events">
        <BrandLogo />
      </Link>
      <h1>{t("notFoundTitle")}</h1>
      <p>{t("notFoundText")}</p>
      <Link className="button button-primary" href="/events">
        {t("backToEvents")}
      </Link>
    </main>
  );
}

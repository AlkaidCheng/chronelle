import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LocaleMenu } from "./locale-menu";

/**
 * The two-column frame every account screen shares: the brand intro and a
 * form, with the language menu at the bottom of the form column.
 */
export function AccountPage({
  children,
  footnote,
}: {
  readonly children: ReactNode;
  readonly footnote?: string | undefined;
}) {
  const t = useTranslations("auth");
  return (
    <main className="sign-in-page">
      <section className="sign-in-intro">
        <a className="brand brand-light" href="/sign-in">
          <span className="brand-mark">C</span>
          <span>Chronelle</span>
        </a>
        <div>
          <p className="eyebrow eyebrow-light">{t("eyebrow")}</p>
          <h1>{t("tagline")}</h1>
          <p>{t("intro")}</p>
        </div>
        {footnote === undefined ? null : (
          <p className="sign-in-footnote">{footnote}</p>
        )}
      </section>
      <section className="sign-in-form-wrap">
        {children}
        <div className="sign-in-language">
          <LocaleMenu />
        </div>
      </section>
    </main>
  );
}

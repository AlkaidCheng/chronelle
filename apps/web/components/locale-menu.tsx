"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import {
  isLocale,
  type LocaleChoice,
  useLocaleChoice,
} from "../i18n/locale-preference";
import { locales } from "../i18n/locales";
import { GlobeIcon } from "./icons";

/**
 * A compact language menu for the screens outside a session: a globe, the
 * word Language (visible when asked, for a footer beside another menu), and
 * a select with System and each language in itself. Settings holds the
 * full control once signed in.
 */
export function LocaleMenu({
  labelled = false,
}: {
  readonly labelled?: boolean | undefined;
}) {
  const id = useId();
  const t = useTranslations("theme");
  const { choice, setChoice } = useLocaleChoice();
  return (
    <div className="locale-menu">
      <GlobeIcon className="locale-menu-icon" />
      <label
        className={labelled ? "locale-menu-label" : "visually-hidden"}
        htmlFor={id}
      >
        {t("language")}
      </label>
      <select
        id={id}
        value={choice}
        onChange={(event) => {
          const next = event.target.value;
          setChoice(isLocale(next) ? next : ("system" satisfies LocaleChoice));
        }}
      >
        <option value="system">{t("system")}</option>
        {locales.map((locale) => (
          <option key={locale.tag} lang={locale.tag} value={locale.tag}>
            {locale.native}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";

import {
  isLocale,
  type LocaleChoice,
  useLocaleChoice,
} from "../i18n/locale-preference";
import { locales } from "../i18n/locales";

/**
 * The language menu: System for the browser's, then each language in its
 * own language. Settings shows it under Language & time, labelled by its
 * row, where a change is also kept on the account through `onChange`.
 */
export function LocaleControl({
  onChange,
  ...attributes
}: {
  readonly id?: string;
  readonly className?: string;
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
  readonly onChange?: ((choice: LocaleChoice) => void) | undefined;
}) {
  const t = useTranslations("theme");
  const { choice, setChoice } = useLocaleChoice();
  return (
    <select
      {...attributes}
      onChange={(event) => {
        const next = event.target.value;
        const chosen = isLocale(next) ? next : "system";
        setChoice(chosen);
        onChange?.(chosen);
      }}
      value={choice}
    >
      <option value="system">{t("system")}</option>
      {locales.map((locale) => (
        <option key={locale.tag} lang={locale.tag} value={locale.tag}>
          {locale.native}
        </option>
      ))}
    </select>
  );
}

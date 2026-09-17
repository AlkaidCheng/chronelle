"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { type LocaleChoice, useLocaleChoice } from "../i18n/locale-preference";
import { locales } from "../i18n/locales";

/**
 * The language choices, each in its own language, with System for the
 * browser's. Used by the Theme panel and the sign-in Customize dialog.
 */
export function LocaleControl() {
  const id = useId();
  const t = useTranslations("theme");
  const { choice, setChoice } = useLocaleChoice();
  const choices: readonly { value: LocaleChoice; label: string }[] = [
    { value: "system", label: t("system") },
    ...locales.map((locale) => ({ value: locale.tag, label: locale.native })),
  ];
  return (
    <fieldset className="theme-group">
      <legend>{t("language")}</legend>
      <div className="theme-segment locale-choices">
        {choices.map((entry) => (
          <label
            key={entry.value}
            lang={entry.value === "system" ? undefined : entry.value}
          >
            <input
              type="radio"
              name={`${id}-locale`}
              value={entry.value}
              checked={choice === entry.value}
              onChange={() => setChoice(entry.value)}
            />
            <span>{entry.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

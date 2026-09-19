"use client";

import { useTranslations } from "next-intl";

import { useLocaleChoice } from "../i18n/locale-preference";
import { locales } from "../i18n/locales";
import { GlobeIcon } from "./icons";
import { MenuItem, QuietMenu } from "./quiet-menu";

/**
 * The language menu of the screens outside a session: a chip that reads
 * "Language: English" and opens System and each language in itself.
 * Settings holds the full control once signed in.
 */
export function LocaleMenu() {
  const t = useTranslations("theme");
  const { choice, setChoice } = useLocaleChoice();
  const current =
    locales.find((locale) => locale.tag === choice)?.native ?? t("system");
  return (
    <QuietMenu
      align="start"
      icon={<GlobeIcon className="quiet-menu-chip-icon" />}
      label={t("language")}
      text={t("languageMenu", { language: current })}
    >
      <MenuItem
        checked={choice === "system"}
        onSelect={() => setChoice("system")}
      >
        {t("system")}
      </MenuItem>
      {locales.map((locale) => (
        <MenuItem
          key={locale.tag}
          checked={choice === locale.tag}
          onSelect={() => setChoice(locale.tag)}
        >
          <span lang={locale.tag}>{locale.native}</span>
        </MenuItem>
      ))}
    </QuietMenu>
  );
}

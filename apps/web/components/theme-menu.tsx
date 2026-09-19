"use client";

import { useTranslations } from "next-intl";

import { displayChoices } from "../lib/display-preferences";
import { useDisplayPreference } from "../lib/use-display-preference";
import { SunIcon } from "./icons";
import { MenuItem, QuietMenu } from "./quiet-menu";

/**
 * The theme menu of the screens outside a session: a chip that reads
 * "Theme: System" and opens System, Light, and Dark. The Theme panel holds
 * the full control once signed in.
 */
export function ThemeMenu() {
  const t = useTranslations("theme");
  const { value, setValue } = useDisplayPreference("appearance");
  return (
    <QuietMenu
      align="start"
      icon={<SunIcon className="quiet-menu-chip-icon" />}
      label={t("title")}
      text={t("themeMenu", { theme: t(value) })}
    >
      {displayChoices.appearance.map((choice) => (
        <MenuItem
          key={choice}
          checked={value === choice}
          onSelect={() => setValue(choice)}
        >
          {t(choice)}
        </MenuItem>
      ))}
    </QuietMenu>
  );
}

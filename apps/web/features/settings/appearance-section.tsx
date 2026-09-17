"use client";

import { useTranslations } from "next-intl";

import { ThemeControls } from "../../components/theme-controls";

/** The Theme panel's choices, repeated here so Settings holds every preference. */
export function AppearanceSection() {
  const t = useTranslations("settings");
  return (
    <div className="settings-appearance">
      <p className="settings-note">{t("appearanceNote")}</p>
      <ThemeControls />
    </div>
  );
}

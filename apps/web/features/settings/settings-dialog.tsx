"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  GlobeIcon,
  InfoIcon,
  KeyboardIcon,
  ThemeIcon,
} from "../../components/icons";
import {
  type DialogSection,
  SectionDialog,
} from "../../components/section-dialog";
import {
  closeSettings,
  parseSettingsSection,
  type SettingsSection,
  showSettingsSection,
  useSettingsSection,
} from "../../lib/settings-address";
import { useKeyboardDevice } from "../../lib/use-keyboard-device";
import { AccountSettings } from "./account-settings";
import { AppearanceSection } from "./appearance-section";
import { KeyboardSection } from "./keyboard-section";
import { LanguageTimeSettings } from "./language-time-settings";

/**
 * Settings, as a dialog over the page it opens from: General (the
 * account); under Preferences, Language & time, Appearance, and on a
 * keyboard device Keyboard. A space's members are managed from the space
 * switcher's Manage space, not here. Without a keyboard,
 * Keyboard is listed only while its address has it open, and says it
 * needs one.
 */
function SettingsDialog({
  section,
  onSelect,
  onClose,
}: {
  readonly section: SettingsSection;
  readonly onSelect: (section: SettingsSection) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("settings");
  const keyboard = useKeyboardDevice();
  const preferences = t("preferences");
  const sections: DialogSection[] = [
    { id: "general", label: t("general"), icon: <InfoIcon /> },
    {
      id: "language",
      label: t("languageTime"),
      icon: <GlobeIcon />,
      group: preferences,
    },
    {
      id: "appearance",
      label: t("appearance"),
      icon: <ThemeIcon />,
      group: preferences,
    },
    ...(keyboard || section === "keyboard"
      ? [
          {
            id: "keyboard",
            label: t("keyboard"),
            icon: <KeyboardIcon />,
            group: preferences,
          },
        ]
      : []),
  ];
  const bodies: Record<SettingsSection, ReactNode> = {
    general: <AccountSettings />,
    language: <LanguageTimeSettings />,
    appearance: <AppearanceSection />,
    keyboard: <KeyboardSection />,
  };
  return (
    <SectionDialog
      label={t("title")}
      heading={t("title")}
      sections={sections}
      current={section}
      onSelect={(id) => {
        const next = parseSettingsSection(id);
        if (next !== null) onSelect(next);
      }}
      onClose={onClose}
      closeLabel={t("close")}
    >
      {bodies[section]}
    </SectionDialog>
  );
}

/**
 * Settings over the current page while the address names one of its
 * sections: choosing a section replaces the address, and closing returns
 * to the page as it was left.
 */
export function SettingsLayer() {
  const section = useSettingsSection();
  if (section === null) return null;
  return (
    <SettingsDialog
      section={section}
      onSelect={showSettingsSection}
      onClose={closeSettings}
    />
  );
}

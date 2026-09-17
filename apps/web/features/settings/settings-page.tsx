"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AccountSettings } from "./account-settings";
import { AppearanceSection } from "./appearance-section";
import { LanguageTimeSettings } from "./language-time-settings";
import { MembersSection } from "./members-section";

/** The sections of Settings, each with its own address. */
export type SettingsSection = "account" | "language" | "appearance" | "members";

export const settingsSections: readonly {
  readonly id: SettingsSection;
  readonly href: string;
}[] = [
  { id: "account", href: "/settings" },
  { id: "language", href: "/settings/language" },
  { id: "appearance", href: "/settings/appearance" },
  { id: "members", href: "/settings/members" },
];

/**
 * Settings, reached from the profile menu: a list of sections at the left
 * (Account; under Preferences, Language & time and Appearance; under
 * Workspace, Members), the open section at the right. Each section has its own address, so it can be
 * bookmarked and reached again.
 */
export function SettingsPage({
  section,
}: {
  readonly section: SettingsSection;
}) {
  const t = useTranslations("settings");
  const entry = (id: SettingsSection, label: string) => (
    <li>
      <Link
        aria-current={section === id ? "page" : undefined}
        href={
          settingsSections.find((item) => item.id === id)?.href ?? "/settings"
        }
      >
        {label}
      </Link>
    </li>
  );
  const titles: Record<SettingsSection, string> = {
    account: t("account"),
    language: t("languageTime"),
    appearance: t("appearance"),
    members: t("members"),
  };
  const bodies: Record<SettingsSection, ReactNode> = {
    account: <AccountSettings />,
    language: <LanguageTimeSettings />,
    appearance: <AppearanceSection />,
    members: <MembersSection />,
  };
  return (
    <main className="workspace-page settings-page" tabIndex={-1}>
      <header className="page-heading">
        <h1>{t("title")}</h1>
      </header>
      <div className="settings-layout">
        <nav aria-label={t("sections")} className="settings-nav">
          <ul>
            {entry("account", t("account"))}
            <li className="settings-nav-group">
              <span>{t("preferences")}</span>
              <ul>
                {entry("language", t("languageTime"))}
                {entry("appearance", t("appearance"))}
              </ul>
            </li>
            <li className="settings-nav-group">
              <span>{t("workspace")}</span>
              <ul>{entry("members", t("members"))}</ul>
            </li>
          </ul>
        </nav>
        <section
          aria-labelledby="settings-section-title"
          className="settings-section"
        >
          <h2 id="settings-section-title">{titles[section]}</h2>
          {bodies[section]}
        </section>
      </div>
    </main>
  );
}

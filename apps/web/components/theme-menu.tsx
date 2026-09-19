"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { displayChoices } from "../lib/display-preferences";
import { useDisplayPreference } from "../lib/use-display-preference";
import { ThemeIcon } from "./icons";

/**
 * A compact theme menu for the screens outside a session: an icon and a
 * select with System, Light, and Dark. The Theme panel holds the full
 * control once signed in.
 */
export function ThemeMenu({
  labelled = false,
}: {
  readonly labelled?: boolean | undefined;
}) {
  const id = useId();
  const t = useTranslations("theme");
  const { value, setValue } = useDisplayPreference("appearance");
  return (
    <div className="locale-menu">
      <ThemeIcon className="locale-menu-icon" />
      <label
        className={labelled ? "locale-menu-label" : "visually-hidden"}
        htmlFor={id}
      >
        {t("title")}
      </label>
      <select
        id={id}
        onChange={(event) => {
          const next = event.target.value;
          const choice = displayChoices.appearance.find((c) => c === next);
          if (choice !== undefined) setValue(choice);
        }}
        value={value}
      >
        {displayChoices.appearance.map((choice) => (
          <option key={choice} value={choice}>
            {t(choice)}
          </option>
        ))}
      </select>
    </div>
  );
}

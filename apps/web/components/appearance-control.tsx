"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { displayChoices } from "../lib/display-preferences";
import { useDisplayPreference } from "../lib/use-display-preference";

export function AppearanceControl() {
  const name = useId();
  const t = useTranslations("theme");
  const { value: appearance, setValue: setAppearance } =
    useDisplayPreference("appearance");
  return (
    <fieldset className="appearance-control">
      <legend className="visually-hidden">{t("appearance")}</legend>
      {displayChoices.appearance.map((value) => (
        <label key={value}>
          <input
            checked={appearance === value}
            name={name}
            onChange={() => setAppearance(value)}
            type="radio"
            value={value}
          />
          <span>{t(value)}</span>
        </label>
      ))}
    </fieldset>
  );
}

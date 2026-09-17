"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { palettes } from "../lib/display-preferences";
import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../lib/use-display-preference";
import { AppearanceControl } from "./appearance-control";

/**
 * The mode, palette, density, and motion choices with the reset link:
 * the Theme panel's body, repeated by Settings under Appearance. Choices
 * apply to this browser only.
 */
export function ThemeControls() {
  const id = useId();
  const t = useTranslations("theme");
  const palette = useDisplayPreference("palette");
  const density = useDisplayPreference("density");
  const motion = useDisplayPreference("motion");
  return (
    <>
      <div className="theme-group">
        <span id={`${id}-mode`}>{t("mode")}</span>
        <AppearanceControl />
      </div>
      <fieldset className="theme-group">
        <legend>{t("palette")}</legend>
        <div className="theme-swatches">
          {palettes.map((choice) => (
            <label
              className="theme-swatch"
              data-checked={palette.value === choice.id || undefined}
              key={choice.id}
            >
              <span
                className="palette-preview"
                data-palette={choice.id}
                aria-hidden="true"
              >
                <span>Aa</span>
                <i />
                <i />
                <b />
              </span>
              <input
                type="radio"
                name={`${id}-palette`}
                checked={palette.value === choice.id}
                onChange={() => palette.setValue(choice.id)}
              />
              {t(`palettes.${choice.id}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="theme-group">
        <legend>{t("density")}</legend>
        <div className="theme-segment">
          <label>
            <input
              type="radio"
              name={`${id}-density`}
              checked={density.value === "comfortable"}
              onChange={() => density.setValue("comfortable")}
            />
            <span>{t("comfortable")}</span>
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-density`}
              checked={density.value === "compact"}
              onChange={() => density.setValue("compact")}
            />
            <span>{t("compact")}</span>
          </label>
        </div>
      </fieldset>
      <fieldset className="theme-group">
        <legend>{t("motion")}</legend>
        <div className="theme-segment">
          <label>
            <input
              type="radio"
              name={`${id}-motion`}
              checked={motion.value === "system"}
              onChange={() => motion.setValue("system")}
            />
            <span>{t("system")}</span>
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-motion`}
              checked={motion.value === "reduced"}
              onChange={() => motion.setValue("reduced")}
            />
            <span>{t("reduced")}</span>
          </label>
        </div>
      </fieldset>
      <button
        type="button"
        className="theme-reset"
        onClick={resetDisplayPreferences}
      >
        {t("reset")}
      </button>
    </>
  );
}

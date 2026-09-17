"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { palettes } from "../lib/display-preferences";
import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../lib/use-display-preference";
import { AppearanceControl } from "./appearance-control";
import { ThemeIcon } from "./icons";
import { LocaleControl } from "./locale-control";

/**
 * The sidebar's Theme entry: a panel beside it with the mode, palette,
 * density, and motion choices. Escape or a press outside closes the panel
 * and returns focus to the entry. Choices apply to this browser only.
 */
export function ThemePanel() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const t = useTranslations("theme");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const palette = useDisplayPreference("palette");
  const density = useDisplayPreference("density");
  const motion = useDisplayPreference("motion");

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input:checked")?.focus();
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      setOpen(false);
    }
    // Escape closes from anywhere: a pointer press on a control does not
    // move focus into the panel in every browser.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-entry" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="sidebar-entry"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((current) => !current)}
      >
        <ThemeIcon />
        {t("title")}
      </button>
      {open ? (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label={t("title")}
          className="theme-panel"
        >
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
          <LocaleControl />
          <button
            type="button"
            className="theme-reset"
            onClick={resetDisplayPreferences}
          >
            {t("reset")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

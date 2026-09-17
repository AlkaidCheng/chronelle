"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthSession } from "../lib/auth-session";
import { palettes } from "../lib/display-preferences";
import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../lib/use-display-preference";
import { useSessionDialog } from "../lib/use-session-dialog";
import { AppearanceControl } from "./appearance-control";
import { LocaleControl } from "./locale-control";

export function AppearanceSettings() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("theme");
  const { isHydrated } = useAuthSession();
  return (
    <div className="appearance-toolbar">
      <AppearanceControl />
      <button
        className="button button-quiet"
        type="button"
        disabled={!isHydrated}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
        aria-label={t("customizeAppearance")}
      >
        {t("customize")}
      </button>
      {open &&
        createPortal(
          <AppearanceDialog onClose={() => setOpen(false)} />,
          document.body,
        )}
    </div>
  );
}

function AppearanceDialog({ onClose }: { readonly onClose: () => void }) {
  const dialog = useSessionDialog(onClose);
  const id = useId();
  const t = useTranslations("theme");
  const palette = useDisplayPreference("palette");
  const density = useDisplayPreference("density");
  const motion = useDisplayPreference("motion");
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog appearance-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>{t("appearance")}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("closeDialog")}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body appearance-body">
        <p id={`${id}-description`}>{t("dialogIntro")}</p>
        <fieldset className="palette-choices">
          <legend>{t("colorPalette")}</legend>
          <div className="palette-grid">
            {palettes.map((choice) => (
              <label className="palette-choice" key={choice.id}>
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
                <span className="palette-label">
                  <input
                    type="radio"
                    name={`${id}-palette`}
                    checked={palette.value === choice.id}
                    onChange={() => palette.setValue(choice.id)}
                  />
                  <strong>{t(`palettes.${choice.id}`)}</strong>
                </span>
                <span className="palette-description">
                  {t(`paletteDescriptions.${choice.id}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="appearance-setting-row">
          <div>
            <h3>{t("lightAndDark")}</h3>
            <p>{t("lightAndDarkNote")}</p>
          </div>
          <AppearanceControl />
        </div>
        <div className="display-settings-grid">
          <fieldset className="display-choice-group">
            <legend>{t("density")}</legend>
            <label>
              <input
                type="radio"
                name={`${id}-density`}
                checked={density.value === "comfortable"}
                onChange={() => density.setValue("comfortable")}
              />
              {t("comfortable")}
              <span>{t("comfortableNote")}</span>
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-density`}
                checked={density.value === "compact"}
                onChange={() => density.setValue("compact")}
              />
              {t("compact")}
              <span>{t("compactNote")}</span>
            </label>
          </fieldset>
          <fieldset className="display-choice-group">
            <legend>{t("motion")}</legend>
            <label>
              <input
                type="radio"
                name={`${id}-motion`}
                checked={motion.value === "system"}
                onChange={() => motion.setValue("system")}
              />
              {t("system")}
              <span>{t("motionSystemNote")}</span>
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-motion`}
                checked={motion.value === "reduced"}
                onChange={() => motion.setValue("reduced")}
              />
              {t("reduced")}
              <span>{t("motionReducedNote")}</span>
            </label>
          </fieldset>
        </div>
        <LocaleControl />
        <p className="appearance-storage-note">{t("storageNote")}</p>
      </div>
      <footer className="event-create-footer">
        <button
          type="button"
          className="button button-quiet"
          onClick={resetDisplayPreferences}
        >
          {t("reset")}
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          {t("done")}
        </button>
      </footer>
    </dialog>
  );
}

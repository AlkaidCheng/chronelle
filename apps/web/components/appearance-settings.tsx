"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { palettes } from "../lib/display-preferences";
import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../lib/use-display-preference";
import { useSessionDialog } from "../lib/use-session-dialog";
import { AppearanceControl } from "./appearance-control";

export function AppearanceSettings() {
  const [open, setOpen] = useState(false);
  return (
    <div className="appearance-toolbar">
      <AppearanceControl />
      <button
        className="button button-quiet"
        type="button"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
        aria-label="Customize appearance"
      >
        Customize
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
        <h2 id={`${id}-title`}>Appearance</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close appearance settings"
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body appearance-body">
        <p id={`${id}-description`}>
          Make this space yours. Changes apply immediately on this browser,
          without changing anyone else's workspace.
        </p>
        <fieldset className="palette-choices">
          <legend>Color palette</legend>
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
                  <strong>{choice.name}</strong>
                </span>
                <span className="palette-description">
                  {choice.description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="appearance-setting-row">
          <div>
            <h3>Light and dark</h3>
            <p>Every palette supports both. System follows your device.</p>
          </div>
          <AppearanceControl />
        </div>
        <div className="display-settings-grid">
          <fieldset className="display-choice-group">
            <legend>Density</legend>
            <label>
              <input
                type="radio"
                name={`${id}-density`}
                checked={density.value === "comfortable"}
                onChange={() => density.setValue("comfortable")}
              />
              Comfortable<span>More space between records</span>
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-density`}
                checked={density.value === "compact"}
                onChange={() => density.setValue("compact")}
              />
              Compact<span>Closer rows, full-size controls</span>
            </label>
          </fieldset>
          <fieldset className="display-choice-group">
            <legend>Motion</legend>
            <label>
              <input
                type="radio"
                name={`${id}-motion`}
                checked={motion.value === "system"}
                onChange={() => motion.setValue("system")}
              />
              System<span>Respect device motion preferences</span>
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-motion`}
                checked={motion.value === "reduced"}
                onChange={() => motion.setValue("reduced")}
              />
              Reduced<span>Minimize movement and transitions</span>
            </label>
          </fieldset>
        </div>
        <p className="appearance-storage-note">
          Saved only when browser storage is available. Reset affects display
          settings only, never your events or files.
        </p>
      </div>
      <footer className="event-create-footer">
        <button
          type="button"
          className="button button-quiet"
          onClick={resetDisplayPreferences}
        >
          Reset display settings
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          Done
        </button>
      </footer>
    </dialog>
  );
}

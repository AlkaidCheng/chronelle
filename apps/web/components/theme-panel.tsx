"use client";

import { useEffect, useId, useRef, useState } from "react";
import { palettes } from "../lib/display-preferences";
import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../lib/use-display-preference";
import { AppearanceControl } from "./appearance-control";
import { ThemeIcon } from "./icons";

/**
 * The sidebar's Theme entry: a panel beside it with the mode, palette,
 * density, and motion choices. Escape or a press outside closes the panel
 * and returns focus to the entry. Choices apply to this browser only.
 */
export function ThemePanel() {
  const [open, setOpen] = useState(false);
  const id = useId();
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
        Theme
      </button>
      {open ? (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label="Theme"
          className="theme-panel"
        >
          <div className="theme-group">
            <span id={`${id}-mode`}>Mode</span>
            <AppearanceControl />
          </div>
          <fieldset className="theme-group">
            <legend>Palette</legend>
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
                  {choice.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="theme-group">
            <legend>Density</legend>
            <div className="theme-segment">
              <label>
                <input
                  type="radio"
                  name={`${id}-density`}
                  checked={density.value === "comfortable"}
                  onChange={() => density.setValue("comfortable")}
                />
                <span>Comfortable</span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`${id}-density`}
                  checked={density.value === "compact"}
                  onChange={() => density.setValue("compact")}
                />
                <span>Compact</span>
              </label>
            </div>
          </fieldset>
          <fieldset className="theme-group">
            <legend>Motion</legend>
            <div className="theme-segment">
              <label>
                <input
                  type="radio"
                  name={`${id}-motion`}
                  checked={motion.value === "system"}
                  onChange={() => motion.setValue("system")}
                />
                <span>System</span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`${id}-motion`}
                  checked={motion.value === "reduced"}
                  onChange={() => motion.setValue("reduced")}
                />
                <span>Reduced</span>
              </label>
            </div>
          </fieldset>
          <button
            type="button"
            className="theme-reset"
            onClick={resetDisplayPreferences}
          >
            Reset display settings
          </button>
        </div>
      ) : null}
    </div>
  );
}

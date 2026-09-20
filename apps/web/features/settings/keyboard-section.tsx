"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  useCommandShortcut,
  useEditorShortcut,
} from "../../lib/shortcut-preference";
import {
  componentShortcuts,
  parseComponentShortcut,
  useComponentShortcut,
} from "../../lib/use-component-shortcut";
import { useKeyboardDevice } from "../../lib/use-keyboard-device";

/** The modifier as the viewer's platform names it; null until hydration. */
function useModifier(): string | null {
  const [modifier, setModifier] = useState<string | null>(null);
  useEffect(() => {
    setModifier(/Mac|iPhone|iPad/u.test(navigator.platform) ? "Cmd" : "Ctrl");
  }, []);
  return modifier;
}

/**
 * The Keyboard section of Settings: one table of the shortcuts, each with
 * its keys and its control. It renders only on a device with a keyboard;
 * elsewhere a line says so. The choices are kept on this browser.
 */
export function KeyboardSection() {
  const t = useTranslations("keyboard");
  const keyboard = useKeyboardDevice();
  const modifier = useModifier() ?? "Cmd";
  const command = useCommandShortcut();
  const component = useComponentShortcut();
  const editor = useEditorShortcut();
  if (!keyboard) return <p className="settings-note">{t("keyboardOnly")}</p>;
  const keys = (...parts: readonly string[]) => (
    <span className="keyboard-keys">
      {parts.map((part) => (
        <kbd key={part}>{part}</kbd>
      ))}
    </span>
  );
  const alwaysOn = <span className="keyboard-fixed">{t("alwaysOn")}</span>;
  return (
    <div className="settings-keyboard">
      <p className="settings-note">{t("lead")}</p>
      <table className="keyboard-table">
        <thead>
          <tr>
            <th scope="col">{t("action")}</th>
            <th scope="col">{t("shortcut")}</th>
            <th scope="col">
              <span className="visually-hidden">{t("control")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>{t("search")}</strong>
              <small>{t("searchNote")}</small>
            </td>
            <td>{keys(modifier, "K")}</td>
            <td>
              <input
                aria-checked={command.value === "enabled"}
                aria-label={t("search")}
                checked={command.value === "enabled"}
                className="settings-switch-input"
                onChange={(event) =>
                  command.setValue(
                    event.target.checked ? "enabled" : "disabled",
                  )
                }
                role="switch"
                type="checkbox"
              />
            </td>
          </tr>
          <tr>
            <td>
              <strong>{t("undo")}</strong>
              <small>{t("undoNote")}</small>
            </td>
            <td>{keys(modifier, "Z")}</td>
            <td>{alwaysOn}</td>
          </tr>
          <tr>
            <td>
              <strong>{t("sidebar")}</strong>
              <small>{t("sidebarNote")}</small>
            </td>
            <td>{keys(modifier, "\\")}</td>
            <td>{alwaysOn}</td>
          </tr>
          <tr>
            <td>
              <strong>{t("component")}</strong>
              <small>{t("componentNote")}</small>
            </td>
            <td>
              {component.value === "disabled"
                ? null
                : component.value === "slash"
                  ? keys("/")
                  : keys(modifier, "/")}
            </td>
            <td>
              <select
                aria-label={t("component")}
                className="keyboard-select"
                value={component.value}
                onChange={(event) =>
                  component.setValue(parseComponentShortcut(event.target.value))
                }
              >
                {Object.entries(componentShortcuts).map(([value, choice]) => (
                  <option key={value} value={value}>
                    {value === "disabled"
                      ? t("off")
                      : choice.label.replace("Cmd/Ctrl", modifier)}
                  </option>
                ))}
              </select>
            </td>
          </tr>
          <tr>
            <td>
              <strong>{t("submit")}</strong>
              <small>{t("submitNote")}</small>
            </td>
            <td>{keys(modifier, "Enter")}</td>
            <td>
              <input
                aria-checked={editor.value === "enabled"}
                aria-label={t("submit")}
                checked={editor.value === "enabled"}
                className="settings-switch-input"
                onChange={(event) =>
                  editor.setValue(event.target.checked ? "enabled" : "disabled")
                }
                role="switch"
                type="checkbox"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <button
        type="button"
        className="button button-quiet"
        onClick={() => {
          command.setValue("enabled");
          component.setValue("slash");
          editor.setValue("enabled");
        }}
      >
        {t("reset")}
      </button>
    </div>
  );
}

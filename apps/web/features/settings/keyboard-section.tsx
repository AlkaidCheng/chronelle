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
 * The Keyboard section of Settings: one table of the shortcuts, a row
 * each, its name and note at the left, its keys and its control at the
 * right. It renders only on a device with a keyboard; elsewhere a line says
 * so. The choices are kept on this browser.
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
  const action = (name: string, note: string) => (
    <td>
      <div className="setting-row-text">
        <span className="setting-row-label">{name}</span>
        <span className="setting-row-caption">{note}</span>
      </div>
    </td>
  );
  const alwaysOn = <span className="keyboard-fixed">{t("alwaysOn")}</span>;
  return (
    <div className="settings-keyboard">
      <p className="settings-note">{t("lead")}</p>
      <table className="keyboard-table">
        <thead>
          <tr>
            {[t("action"), t("shortcut"), t("control")].map((heading) => (
              <th key={heading} scope="col">
                <span className="visually-hidden">{heading}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {action(t("search"), t("searchNote"))}
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
            {action(t("undo"), t("undoNote"))}
            <td>{keys(modifier, "Z")}</td>
            <td>{alwaysOn}</td>
          </tr>
          <tr>
            {action(t("sidebar"), t("sidebarNote"))}
            <td>{keys(modifier, "\\")}</td>
            <td>{alwaysOn}</td>
          </tr>
          <tr>
            {action(t("component"), t("componentNote"))}
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
                className="setting-select"
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
            {action(t("submit"), t("submitNote"))}
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
        className="setting-reset"
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

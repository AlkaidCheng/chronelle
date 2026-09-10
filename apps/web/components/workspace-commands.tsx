"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useSessionDialog } from "../lib/use-session-dialog";
import { useEditorShortcut } from "../lib/shortcut-preference";
import {
  componentShortcuts,
  parseComponentShortcut,
  useComponentShortcut,
} from "../lib/use-component-shortcut";
import { workspaceDestinations } from "./workspace-navigation";

export function WorkspaceCommands({
  workspaceName,
  shortcutEnabled,
  onShortcutChange,
  onClose,
}: {
  readonly workspaceName: string;
  readonly shortcutEnabled: boolean;
  readonly onShortcutChange: (enabled: boolean) => void;
  readonly onClose: () => void;
}) {
  const dialog = useSessionDialog(onClose);
  const componentShortcut = useComponentShortcut();
  const editorShortcut = useEditorShortcut();
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const backdropPress = useRef(false);
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = workspaceDestinations.filter((destination) =>
    `${destination.label} ${destination.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selected = matches[index];
  useEffect(() => {
    input.current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The selected destination changes which option must be visible.
  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [selected?.href]);

  function activate(href: string) {
    onClose();
    router.push(href);
  }
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog workspace-commands"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-scope`}
      onCancel={(event) => {
        event.preventDefault();
        if (!composing.current) onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget)
          onClose();
        backdropPress.current = false;
      }}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>Commands</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close commands"
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body command-body">
        <p id={`${id}-scope`} className="field-hint">
          Navigate {workspaceName}. To find records, open Search.
        </p>
        <label className="field">
          Find a command
          <input
            ref={input}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-results`}
            aria-activedescendant={
              selected ? `${id}-${selected.href.slice(1)}` : undefined
            }
            autoComplete="off"
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                composing.current ||
                event.keyCode === 229 ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (matches.length)
                  setIndex(
                    (index +
                      (event.key === "ArrowDown" ? 1 : matches.length - 1)) %
                      matches.length,
                  );
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (selected && !event.repeat) activate(selected.href);
              }
            }}
          />
        </label>
        <div
          id={`${id}-results`}
          className="command-results"
          role="listbox"
          aria-label="Workspace destinations"
        >
          {matches.map((destination, optionIndex) => (
            <button
              type="button"
              tabIndex={-1}
              ref={index === optionIndex ? activeOption : undefined}
              key={destination.href}
              id={`${id}-${destination.href.slice(1)}`}
              role="option"
              aria-selected={index === optionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => activate(destination.href)}
            >
              <destination.icon />
              <span>
                <strong>{destination.label}</strong>
                <small>{destination.description}</small>
              </span>
              {pathname.startsWith(destination.href) && <small>Current</small>}
            </button>
          ))}
        </div>
        {matches.length === 0 && (
          <p role="status">
            No matching commands. Try Events, Search, or Trash.
          </p>
        )}
        <details className="command-help">
          <summary>Keyboard shortcuts</summary>
          <p>
            <kbd>Cmd/Ctrl + K</kbd> opens Commands outside editors and dialogs.
            Use Up/Down to choose a result, Enter to open it, and Escape to
            close.
          </p>
          <label>
            <input
              type="checkbox"
              checked={shortcutEnabled}
              onChange={(event) => onShortcutChange(event.target.checked)}
            />{" "}
            Enable command shortcut
          </label>
          <label className="field">
            Add component shortcut
            <select
              value={componentShortcut.value}
              onChange={(event) =>
                componentShortcut.setValue(
                  parseComponentShortcut(event.target.value),
                )
              }
            >
              {Object.entries(componentShortcuts).map(([value, choice]) => (
                <option key={value} value={value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">
            Opens the picker from the selected event page, outside editors and
            dialogs. Requires edit access and room on the page.
          </p>
          <label>
            <input
              type="checkbox"
              checked={editorShortcut.value === "enabled"}
              onChange={(event) =>
                editorShortcut.setValue(
                  event.target.checked ? "enabled" : "disabled",
                )
              }
            />{" "}
            Enable editor submit shortcut
          </label>
          <p className="field-hint">
            <kbd>Cmd/Ctrl + Enter</kbd> saves from an event, schedule, task,
            expense, or reminder field. Save validation still applies.
          </p>
          <p className="field-hint">
            Buttons remain available without shortcuts. These choices are saved
            on this browser when storage is available. Native text undo is
            unchanged.
          </p>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              onShortcutChange(true);
              componentShortcut.setValue("slash");
              editorShortcut.setValue("enabled");
            }}
          >
            Reset keyboard shortcuts
          </button>
        </details>
      </div>
    </dialog>
  );
}

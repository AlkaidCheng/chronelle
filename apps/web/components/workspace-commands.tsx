"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAuthSession } from "../lib/auth-session";
import { useContextCommands } from "./context-commands";
import { useSessionDialog } from "../lib/use-session-dialog";
import { useEditorShortcut } from "../lib/shortcut-preference";
import {
  componentShortcuts,
  parseComponentShortcut,
  useComponentShortcut,
} from "../lib/use-component-shortcut";
import { workspaceDestinations } from "./workspace-navigation";

type Command =
  | ((typeof workspaceDestinations)[number] & {
      readonly kind: "navigation";
      readonly id: string;
    })
  | (ReturnType<typeof useContextCommands>[number] & {
      readonly kind: "context";
    });

function matchingCommands(commands: readonly Command[], query: string) {
  const term = query.trim().toLowerCase();
  return commands.filter((command) =>
    `${command.label} ${command.description}`.toLowerCase().includes(term),
  );
}

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
  const { signal } = useAuthSession();
  const context = useContextCommands();
  const commands: readonly Command[] = [
    ...context.map((command) => ({ ...command, kind: "context" as const })),
    ...workspaceDestinations.map((destination) => ({
      ...destination,
      id: destination.href,
      kind: "navigation" as const,
    })),
  ];
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
  const [selectedId, setSelectedId] = useState<string | null>(
    () => commands[0]?.id ?? null,
  );
  const matches = matchingCommands(commands, query);
  const selected = matches.find((command) => command.id === selectedId);
  useEffect(() => {
    input.current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The selected command changes which option must be visible.
  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  function activate(command: Command) {
    if (signal.aborted || (command.kind === "context" && !command.isCurrent()))
      return;
    flushSync(onClose);
    if (signal.aborted) return;
    if (command.kind === "navigation") {
      router.push(command.href);
      return;
    }
    const target = command.target.current;
    if (
      !command.isCurrent() ||
      !target?.isConnected ||
      target.matches(":disabled") ||
      target.closest("[hidden], [inert]")
    )
      return;
    target.focus();
    if (document.activeElement === target) target.click();
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
          Navigate {workspaceName} or open available event tools. To find
          records, open Search.
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
              selected ? `${id}-${selected.id}` : undefined
            }
            autoComplete="off"
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(
                matchingCommands(commands, event.target.value)[0]?.id ?? null,
              );
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
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
                if (matches.length) {
                  const index = matches.findIndex(
                    (command) => command.id === selectedId,
                  );
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % matches.length
                      : (index < 0
                          ? matches.length - 1
                          : index - 1 + matches.length) % matches.length;
                  setSelectedId(matches[next]?.id ?? null);
                }
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (selected && !event.repeat) activate(selected);
              }
            }}
          />
        </label>
        <div
          id={`${id}-results`}
          className="command-results"
          role="listbox"
          aria-label="Commands"
        >
          {(["context", "navigation"] as const).map((kind) => {
            const options = matches.filter((command) => command.kind === kind);
            if (options.length === 0) return null;
            const label = kind === "context" ? "Event actions" : "Navigation";
            return (
              // biome-ignore lint/a11y/useSemanticElements: These are listbox option groups, not form fieldsets.
              <div role="group" aria-label={label} key={kind}>
                <p className="command-group-label" aria-hidden="true">
                  {label}
                </p>
                {options.map((command) => (
                  <button
                    type="button"
                    tabIndex={-1}
                    ref={selectedId === command.id ? activeOption : undefined}
                    key={command.id}
                    id={`${id}-${command.id}`}
                    role="option"
                    aria-selected={selectedId === command.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => activate(command)}
                  >
                    {command.kind === "navigation" ? (
                      <command.icon />
                    ) : (
                      <span className="command-action-mark" aria-hidden="true">
                        &#8627;
                      </span>
                    )}
                    <span>
                      <strong>{command.label}</strong>
                      <small>{command.description}</small>
                    </span>
                    {command.kind === "navigation" &&
                      pathname.startsWith(command.href) && (
                        <small>Current</small>
                      )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        {matches.length === 0 && (
          <p role="status">
            No matching commands. Try another command, or open Search to find
            records.
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

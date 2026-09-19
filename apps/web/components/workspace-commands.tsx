"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { CommandPaletteSection } from "../lib/command-palette";
import { flushSync } from "react-dom";
import { useAuthSession } from "../lib/auth-session";
import { useCommandSearch } from "../lib/use-command-search";
import { getSearchResultHref } from "../lib/search-result";
import { SearchIcon } from "./icons";
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
      readonly label: string;
      readonly description: string;
    })
  | (ReturnType<typeof useContextCommands>[number] & {
      readonly kind: "context";
    })
  | {
      readonly kind: "record";
      readonly id: string;
      readonly label: string;
      readonly description: string;
      readonly href: string | null;
    };

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
  section,
}: {
  readonly workspaceName: string;
  readonly shortcutEnabled: boolean;
  readonly onShortcutChange: (enabled: boolean) => void;
  readonly onClose: () => void;
  /** Opened at the Keyboard shortcuts section, expanded, its first control focused. */
  readonly section?: CommandPaletteSection | undefined;
}) {
  const t = useTranslations("commands");
  const nav = useTranslations("nav");
  const types = useTranslations("objectTypes");
  const { signal } = useAuthSession();
  const context = useContextCommands();
  const commands: readonly Command[] = [
    ...context.map((command) => ({ ...command, kind: "context" as const })),
    ...workspaceDestinations.map((destination) => ({
      ...destination,
      id: destination.href,
      kind: "navigation" as const,
      label: nav(destination.key),
      description: t(`destinations.${destination.key}`),
    })),
  ];
  const dialog = useSessionDialog(onClose);
  const componentShortcut = useComponentShortcut();
  const editorShortcut = useEditorShortcut();
  const input = useRef<HTMLInputElement>(null);
  const firstShortcutControl = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const backdropPress = useRef(false);
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const search = useCommandSearch(query, isComposing);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => commands[0]?.id ?? null,
  );
  const records: readonly Command[] = search.items.map((record) => {
    const href = getSearchResultHref(record);
    return {
      kind: "record",
      id: `record-${record.id}`,
      label: record.displayName,
      description: t("recordDescription", {
        type: types(record.objectType),
        state: href === null ? t("detailUnavailable") : t("openEvent"),
      }),
      href,
    };
  });
  const matches = [...matchingCommands(commands, query), ...records];
  const selected = matches.find((command) => command.id === selectedId);
  const firstMatchId = matches[0]?.id;
  useEffect(() => {
    if (selectedId === null && firstMatchId) setSelectedId(firstMatchId);
  }, [selectedId, firstMatchId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The section decides the first focus once, at mount.
  useEffect(() => {
    (section === "shortcuts" ? firstShortcutControl : input).current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The selected command changes which option must be visible.
  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  function activate(command: Command) {
    if (
      signal.aborted ||
      isComposing ||
      (command.kind === "context" && !command.isCurrent()) ||
      (command.kind === "record" && command.href === null)
    )
      return;
    flushSync(onClose);
    if (signal.aborted) return;
    if (command.kind !== "context") {
      if (command.href === null) return;
      router.push(command.href);
      return;
    }
    if (command.run) {
      if (command.isCurrent()) command.run();
      return;
    }
    const target = command.target?.current;
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
        if (!isComposing) onClose();
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
        <h2 id={`${id}-title`}>{t("title")}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("close")}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body command-body">
        <p id={`${id}-scope`} className="field-hint">
          {t("scope", { workspace: workspaceName })}
        </p>
        <label className="field">
          {t("find")}
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
            maxLength={120}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(
                matchingCommands(commands, event.target.value)[0]?.id ?? null,
              );
            }}
            onCompositionStart={() => {
              setIsComposing(true);
            }}
            onCompositionEnd={() => {
              setIsComposing(false);
            }}
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                event.nativeEvent.isComposing ||
                isComposing ||
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
                    (command) => command.id === selected?.id,
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
          aria-label={t("listLabel")}
        >
          {(["context", "navigation", "record"] as const).map((kind) => {
            const options = matches.filter((command) => command.kind === kind);
            if (options.length === 0) return null;
            const label = t(`groups.${kind}`);
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
                    ref={selected?.id === command.id ? activeOption : undefined}
                    key={command.id}
                    id={`${id}-${command.id}`}
                    role="option"
                    aria-selected={selected?.id === command.id}
                    aria-disabled={
                      command.kind === "record" && command.href === null
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => activate(command)}
                  >
                    {command.kind === "navigation" ? (
                      <command.icon />
                    ) : command.kind === "record" ? (
                      <SearchIcon />
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
                        <small>{t("current")}</small>
                      )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        {search.isSearching ? (
          <p role="status">{t("searching")}</p>
        ) : search.isError ? (
          <div className="command-search-error" role="alert">
            <p>{t("loadFailed")}</p>
            <button
              type="button"
              className="button button-quiet"
              onClick={search.retry}
            >
              {t("retry")}
            </button>
          </div>
        ) : search.isEmpty ? (
          <p role="status">{t("noRecords")}</p>
        ) : (
          matches.length === 0 && <p role="status">{t("noMatch")}</p>
        )}
        {search.hasMore && <p className="field-hint">{t("showingEight")}</p>}
        {query.trim().length >= 2 && (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              const destination = commands.find(
                (command) => command.id === "/search",
              );
              if (destination) activate(destination);
            }}
          >
            {t("openFull")}
          </button>
        )}
        <details className="command-help" open={section === "shortcuts"}>
          <summary>{t("shortcuts")}</summary>
          <p>
            {t.rich("openShortcut", {
              kbd: (chunks) => <kbd>{chunks}</kbd>,
            })}
          </p>
          <p>
            {t.rich("undoShortcut", {
              kbd: (chunks) => <kbd>{chunks}</kbd>,
            })}
          </p>
          <label>
            <input
              ref={firstShortcutControl}
              type="checkbox"
              checked={shortcutEnabled}
              onChange={(event) => onShortcutChange(event.target.checked)}
            />{" "}
            {t("enableCommand")}
          </label>
          <label className="field">
            {t("componentShortcut")}
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
                  {value === "disabled" ? t("off") : choice.label}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">{t("componentNote")}</p>
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
            {t("enableSubmit")}
          </label>
          <p className="field-hint">
            {t.rich("submitNote", {
              kbd: (chunks) => <kbd>{chunks}</kbd>,
            })}
          </p>
          <p className="field-hint">{t("buttonsNote")}</p>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              onShortcutChange(true);
              componentShortcut.setValue("slash");
              editorShortcut.setValue("enabled");
            }}
          >
            {t("reset")}
          </button>
        </details>
      </div>
    </dialog>
  );
}

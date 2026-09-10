/** Ignores consumed keys, composition, and focus owned by an editor or dialog. */
function canUseShortcut(event: KeyboardEvent) {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.repeat &&
    !event.altKey &&
    event.target instanceof Element &&
    !event.target.closest(
      "input, textarea, select, [contenteditable], [role='textbox'], [role='searchbox'], [role='combobox'], dialog, [role='dialog'], [role='alertdialog']",
    ) &&
    !document.querySelector("dialog[open]")
  );
}

export function canOpenCommands(event: KeyboardEvent) {
  return (
    canUseShortcut(event) &&
    !event.shiftKey &&
    event.metaKey !== event.ctrlKey &&
    event.key.toLowerCase() === "k" &&
    event.target instanceof Element &&
    (event.target === document.body ||
      event.target.closest(".workspace-shell") !== null)
  );
}

export function canInsertComponent(
  event: KeyboardEvent,
  scope: HTMLElement,
  shortcut: "slash" | "modified-slash" | "disabled",
) {
  return (
    canUseShortcut(event) &&
    event.key === "/" &&
    event.target instanceof Element &&
    scope.contains(event.target) &&
    (shortcut === "slash"
      ? !event.metaKey && !event.ctrlKey
      : shortcut === "modified-slash" && event.metaKey !== event.ctrlKey)
  );
}

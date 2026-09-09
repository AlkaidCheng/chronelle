/** Ignores consumed keys, composition, and focus owned by an editor or dialog. */
export function canOpenCommands(event: KeyboardEvent) {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.repeat &&
    !event.altKey &&
    !event.shiftKey &&
    event.metaKey !== event.ctrlKey &&
    event.key.toLowerCase() === "k" &&
    event.target instanceof Element &&
    (event.target === document.body ||
      event.target.closest(".workspace-shell") !== null) &&
    !event.target.closest(
      "input, textarea, select, [contenteditable], [role='textbox'], dialog",
    ) &&
    !document.querySelector("dialog[open]")
  );
}

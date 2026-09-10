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

export function canSubmitEditor(event: KeyboardEvent, form: HTMLFormElement) {
  const target = event.target;
  if (
    event.key !== "Enter" ||
    event.ctrlKey === event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.repeat ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    !(target instanceof HTMLElement) ||
    target !== document.activeElement ||
    target.closest("form") !== form
  )
    return false;
  const dialogs = "dialog, [role='dialog'], [role='alertdialog']";
  return (
    target.closest(dialogs) === form.closest(dialogs) &&
    !Array.from(document.querySelectorAll("dialog[open]")).some(
      (dialog) => !dialog.contains(form),
    ) &&
    !target.closest(
      "[contenteditable], [role='combobox'], [role='searchbox'], [role='textbox']",
    ) &&
    target.matches(
      "input:not([type='checkbox']):not([type='radio']):not([type='file']):not([type='button']):not([type='reset']):not([type='submit']), textarea, button[data-editor-submit]",
    )
  );
}

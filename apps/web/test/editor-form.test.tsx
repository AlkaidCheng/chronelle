// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorForm, EditorSubmitButton } from "../components/editor-form";
import { useEditorShortcut } from "../lib/shortcut-preference";

beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.localStorage.clear();
  delete document.documentElement.dataset.editorShortcut;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function Preference() {
  const shortcut = useEditorShortcut();
  return (
    <button
      type="button"
      onClick={() =>
        shortcut.setValue(shortcut.value === "enabled" ? "disabled" : "enabled")
      }
    >
      Toggle shortcut
    </button>
  );
}

function setup({ disabled = false, busy = false } = {}) {
  const submit = vi.fn();
  render(
    <>
      <EditorForm
        aria-label="Editor"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.nativeEvent);
        }}
      >
        <input aria-label="Title" required />
        <textarea aria-label="Details" />
        <input role="combobox" aria-expanded="false" aria-label="Suggestions" />
        <select aria-label="Month">
          <option>May</option>
        </select>
        <input aria-label="Option" type="checkbox" />
        <fieldset disabled>
          <input aria-label="Unavailable" />
        </fieldset>
        <button type="button">Cancel</button>
        <dialog open aria-label="Nested dialog">
          <input aria-label="Nested draft" />
        </dialog>
        {createPortal(<input aria-label="Portal draft" />, document.body)}
        <EditorSubmitButton disabled={disabled}>Save</EditorSubmitButton>
      </EditorForm>
      <form aria-label="Other form">
        <input aria-label="Other draft" />
      </form>
      <Preference />
    </>,
  );
  screen.getByRole("dialog").removeAttribute("open");
  const title = screen.getByLabelText("Title");
  fireEvent.change(title, { target: { value: "Draft" } });
  title.focus();
  return { submit, title };
}

it.each(["ctrlKey", "metaKey"])(
  "submits the focused editor with %s and the marked button",
  (modifier) => {
    const { submit, title } = setup();
    expect(fireEvent.keyDown(title, { key: "Enter", [modifier]: true })).toBe(
      false,
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0].submitter).toBe(
      screen.getByRole("button", { name: "Save" }),
    );
  },
);

it("submits only the focused editor when multiple editors are mounted", () => {
  const saves = { first: vi.fn(), second: vi.fn() };
  render(
    Object.entries(saves).map(([name, save]) => (
      <EditorForm
        key={name}
        aria-label={`Editor ${name}`}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input aria-label={`Draft ${name}`} defaultValue="Plan" />
        <EditorSubmitButton>Save {name}</EditorSubmitButton>
      </EditorForm>
    )),
  );
  const second = screen.getByLabelText("Draft second");
  second.focus();
  fireEvent.keyDown(second, { key: "Enter", ctrlKey: true });
  expect(saves.first).not.toHaveBeenCalled();
  expect(saves.second).toHaveBeenCalledOnce();
});

it.each([
  { key: "k" },
  { ctrlKey: false },
  { metaKey: true },
  { altKey: true },
  { shiftKey: true },
  { repeat: true },
  { isComposing: true },
  { keyCode: 229 },
])("does not consume guarded input %j", (extra) => {
  const { submit, title } = setup();
  expect(
    fireEvent.keyDown(title, { key: "Enter", ctrlKey: true, ...extra }),
  ).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});

it("respects consumed keys and composition lifetime, including focus changes", () => {
  const { submit, title } = setup();
  const key = new KeyboardEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  key.preventDefault();
  fireEvent(title, key);
  fireEvent.compositionStart(title);
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(title);
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  expect(submit).toHaveBeenCalledOnce();
  fireEvent.compositionStart(title);
  screen.getByLabelText("Details").focus();
  title.focus();
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  expect(submit).toHaveBeenCalledTimes(2);
});

it.each([
  "Suggestions",
  "Month",
  "Option",
  "Unavailable",
  "Nested draft",
  "Portal draft",
  "Other draft",
])("leaves %s outside the shortcut scope", (label) => {
  const { submit } = setup();
  const target = screen.getByLabelText(label);
  target.focus();
  expect(fireEvent.keyDown(target, { key: "Enter", ctrlKey: true })).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});

it("leaves Cancel and focus behind an open dialog untouched", () => {
  const { submit, title } = setup();
  const cancel = screen.getByRole("button", { name: "Cancel" });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Enter", ctrlKey: true });
  title.focus();
  const modal = document.createElement("dialog");
  modal.setAttribute("open", "");
  document.body.append(modal);
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  modal.remove();
  expect(submit).not.toHaveBeenCalled();
});

it.each([{ disabled: true }, { busy: true }])(
  "does not submit an unavailable editor %j",
  (state) => {
    const { submit, title } = setup(state);
    fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
    expect(submit).not.toHaveBeenCalled();
  },
);

it("runs native required validation and permits textarea and save-button focus", () => {
  const { submit, title } = setup();
  fireEvent.change(title, { target: { value: "" } });
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  expect(submit).not.toHaveBeenCalled();
  expect(title).toBeInvalid();
  fireEvent.change(title, { target: { value: "Valid" } });
  for (const target of [
    screen.getByLabelText("Details"),
    screen.getByRole("button", { name: "Save" }),
  ]) {
    target.focus();
    fireEvent.keyDown(target, { key: "Enter", ctrlKey: true });
  }
  expect(submit).toHaveBeenCalledTimes(2);
});

it("updates all consumers, keeps the save button usable when disabled, and persists across remounts", () => {
  const { submit, title } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Toggle shortcut" }));
  expect(window.localStorage.getItem("chronelle.editor-shortcut")).toBe(
    "disabled",
  );
  expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute(
    "aria-keyshortcuts",
  );
  fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submit).toHaveBeenCalledOnce();
  cleanup();
  setup();
  expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute(
    "aria-keyshortcuts",
  );
});

it("retains a disabled choice across remounts when storage writes fail", () => {
  setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  fireEvent.click(screen.getByRole("button", { name: "Toggle shortcut" }));
  cleanup();
  setup();
  expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute(
    "aria-keyshortcuts",
  );
});

it.each(["unrecognized", null])(
  "uses the default for invalid or unavailable storage: %s",
  (value) => {
    if (value) window.localStorage.setItem("chronelle.editor-shortcut", value);
    else
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("Blocked");
      });
    setup();
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Enter Meta+Enter",
    );
  },
);

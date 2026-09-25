// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventLayoutResponse } from "@livtales/schemas";
import { EventPageCanvas } from "../features/events/event-page-canvas";
import { canInsertComponent } from "../lib/keyboard";

const save = { isPending: false, mutate: vi.fn(), isError: false };
vi.mock("../lib/event-layout-queries", () => ({
  useUpdateEventLayout: () => save,
}));
vi.mock("../features/events/event-component", () => ({
  EventComponent: () => <input aria-label="Component draft" />,
}));
const add = vi.fn();
const page = {
  id: "page",
  name: "Preparation",
  components: [{ id: "todos", kind: "todos" as const }],
};
const layout: EventLayoutResponse = {
  eventId: "event",
  version: 1,
  updatedAt: null,
  pages: [page],
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  document.documentElement.dataset.componentShortcut = "slash";
  save.isPending = false;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.componentShortcut;
  vi.unstubAllGlobals();
});
function setup(canEdit = true, source = layout) {
  render(
    <EventPageCanvas
      layout={source}
      selected={source.pages[0]}
      canEdit={canEdit}
      onSelect={vi.fn()}
      onAddPage={vi.fn()}
      onAddComponent={add}
      onRefresh={vi.fn()}
      arranging={false}
      onArrangingChange={vi.fn()}
    />,
  );
  return screen.getByRole("region", { name: "Event pages" });
}

it("opens the existing picker only inside the focused page, without a mutation", () => {
  const target = setup();
  expect(fireEvent.keyDown(document.body, { key: "/" })).toBe(true);
  expect(add).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(target, { key: "/" })).toBe(false);
  expect(add).toHaveBeenCalledOnce();
  expect(save.mutate).not.toHaveBeenCalled();
});

it.each([
  { isComposing: true },
  { keyCode: 229 },
  { repeat: true },
  { altKey: true },
  { ctrlKey: true },
  { metaKey: true },
  { key: "z", ctrlKey: true },
  { key: "z", metaKey: true },
])("leaves guarded keys unconsumed: %j", (extra) => {
  const target = setup();
  expect(fireEvent.keyDown(target, { key: "/", ...extra })).toBe(true);
  expect(add).not.toHaveBeenCalled();
});

it("respects handled events, drafts, and a modal outside the canvas", () => {
  const target = setup();
  const event = new KeyboardEvent("keydown", {
    key: "/",
    bubbles: true,
    cancelable: true,
  });
  event.preventDefault();
  target.dispatchEvent(event);
  expect(
    fireEvent.keyDown(screen.getByLabelText("Component draft"), { key: "/" }),
  ).toBe(true);
  const modal = document.createElement("dialog");
  modal.open = true;
  document.body.append(modal);
  expect(fireEvent.keyDown(target, { key: "/" })).toBe(true);
  modal.remove();
  expect(add).not.toHaveBeenCalled();
});

it.each([
  "textarea",
  "select",
  "[contenteditable]",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='dialog']",
  "[role='alertdialog']",
])("respects focus owned by %s", (selector) => {
  const target = setup();
  const editor = document.createElement(
    selector.startsWith("[") ? "div" : selector,
  );
  if (selector === "[contenteditable]")
    editor.setAttribute("contenteditable", "true");
  else if (selector.startsWith("[role="))
    editor.setAttribute("role", selector.slice(7, -2));
  target.append(editor);
  expect(fireEvent.keyDown(editor, { key: "/" })).toBe(true);
  expect(add).not.toHaveBeenCalled();
});

it.each([
  { reason: "viewer", counts: [1] },
  { reason: "pending", counts: [1] },
  { reason: "full-page", counts: [20] },
  { reason: "full-event", counts: [1, 20, 20, 20, 20, 19] },
  { reason: "no-page", counts: [] },
])("does not insert when $reason", ({ reason, counts }) => {
  save.isPending = reason === "pending";
  const source = {
    ...layout,
    pages: counts.map((count, pageIndex) => ({
      ...page,
      id: `page-${pageIndex}`,
      components: Array.from({ length: count }, (_, index) => ({
        id: `item-${pageIndex}-${index}`,
        kind: "todos" as const,
      })),
    })),
  };
  const target = setup(reason !== "viewer", source);
  expect(fireEvent.keyDown(target, { key: "/" })).toBe(true);
  expect(add).not.toHaveBeenCalled();
});

it.each(["ctrlKey", "metaKey"])(
  "supports modified slash with %s, including layouts that need Shift",
  (modifier) => {
    document.documentElement.dataset.componentShortcut = "modified-slash";
    const target = setup();
    expect(
      screen.getByRole("button", { name: "Add component" }),
    ).toHaveAttribute("aria-keyshortcuts", "Control+/ Meta+/");
    expect(fireEvent.keyDown(target, { key: "/" })).toBe(true);
    expect(
      fireEvent.keyDown(target, { key: "/", [modifier]: true, shiftKey: true }),
    ).toBe(false);
    expect(
      fireEvent.keyDown(target, { key: "/", ctrlKey: true, metaKey: true }),
    ).toBe(true);
    expect(add).toHaveBeenCalledOnce();
  },
);

it("retains the visible control with shortcuts disabled", () => {
  document.documentElement.dataset.componentShortcut = "disabled";
  const target = setup();
  expect(fireEvent.keyDown(target, { key: "/" })).toBe(true);
  expect(fireEvent.keyDown(target, { key: "/", ctrlKey: true })).toBe(true);
  const button = screen.getByRole("button", {
    name: "Add component",
  });
  expect(button).not.toHaveAttribute("aria-keyshortcuts");
  fireEvent.click(button);
  expect(add).toHaveBeenCalledOnce();
});

it("rejects a portal target outside the supplied scope", () => {
  const target = setup();
  const event = new KeyboardEvent("keydown", { key: "/" });
  document.body.dispatchEvent(event);
  expect(canInsertComponent(event, target, "slash")).toBe(false);
});

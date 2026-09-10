// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "../components/workspace-header";
import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";
import { useComponentShortcut } from "../lib/use-component-shortcut";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/events",
}));
const methods = ["showModal", "close"] as const;
const descriptors = methods.map((method) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
);

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal("localStorage", window.sessionStorage);
  window.localStorage.clear();
  delete document.documentElement.dataset.componentShortcut;
  window.sessionStorage.setItem(
    "chronelle.development-session",
    JSON.stringify({ accessToken: "test-session", workspaceId: "personal" }),
  );
  for (const method of methods)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  methods.forEach((method, index) => {
    const descriptor = descriptors[index];
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  });
});

function Harness() {
  const auth = useAuthSession();
  const shortcut = useComponentShortcut();
  return (
    <div className="workspace-shell">
      <WorkspaceHeader workspaceName="Personal" />
      <output aria-label="Component binding">{shortcut.value}</output>
      <input aria-label="Draft" />
      <div contentEditable suppressContentEditableWarning>
        Editable
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: Exercises shortcut guards for custom editors. */}
      <div role="textbox" tabIndex={0}>
        Custom editor
      </div>
      <button type="button" onClick={auth.signOut}>
        Expire session
      </button>
      <button type="button" onClick={() => auth.switchWorkspace("shared")}>
        Switch workspace
      </button>
      <button
        type="button"
        onClick={() =>
          auth.startSession({
            accessToken: "replacement",
            workspaceId: "personal",
          })
        }
      >
        Replace identity
      </button>
      <div id="workspace-content" tabIndex={-1} />
    </div>
  );
}
function setup() {
  render(
    <AuthSessionProvider>
      <Harness />
    </AuthSessionProvider>,
  );
  return userEvent.setup();
}
const trigger = () => {
  const button = screen.getAllByRole("button", { name: "Commands" })[0];
  if (!button) throw new Error("Commands trigger missing");
  return button;
};
const palette = () => screen.getByRole("dialog", { name: "Commands" });
const results = () =>
  within(screen.getByRole("listbox", { name: "Workspace destinations" }));

it("filters destinations, navigates with arrows and Enter, and returns focus", async () => {
  const user = setup();
  await user.click(trigger());
  const input = screen.getByRole("combobox", { name: "Find a command" });
  expect(input).toHaveFocus();
  expect(results().getAllByRole("option")).toHaveLength(3);
  await user.keyboard("{ArrowUp}");
  expect(results().getByRole("option", { selected: true })).toHaveTextContent(
    "Trash",
  );
  await user.keyboard("{ArrowDown}");
  expect(results().getByRole("option", { selected: true })).toHaveTextContent(
    "Events",
  );
  await user.type(input, "access");
  expect(results().getAllByRole("option")).toHaveLength(1);
  expect(input).toHaveAttribute(
    "aria-activedescendant",
    results().getByRole("option").id,
  );
  await user.keyboard("{Enter}");
  expect(push).toHaveBeenCalledExactlyOnceWith("/search");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});

it("leaves an empty result inert and opens destinations by pointer", async () => {
  const user = setup();
  await user.click(trigger());
  const input = screen.getByRole("combobox", { name: "Find a command" });
  await user.type(input, "not a command");
  expect(within(palette()).getByRole("status")).toHaveTextContent(
    "No matching commands",
  );
  expect(input).not.toHaveAttribute("aria-activedescendant");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(push).not.toHaveBeenCalled();
  await user.clear(input);
  await user.click(screen.getByRole("option", { name: /Trash/ }));
  expect(push).toHaveBeenCalledExactlyOnceWith("/trash");
});

it.each([
  { repeat: true },
  { isComposing: true },
  { keyCode: 229 },
  { altKey: true },
  { shiftKey: true },
  { metaKey: true },
  { key: "s" },
])("does not consume guarded command key %j", (extra) => {
  setup();
  expect(
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true, ...extra }),
  ).toBe(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["Draft", "Editable", "Custom editor"])(
  "does not intercept typing in %s",
  (name) => {
    setup();
    const target =
      name === "Draft" ? screen.getByLabelText(name) : screen.getByText(name);
    expect(fireEvent.keyDown(target, { key: "k", metaKey: true })).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

it("respects consumed keys, outside focus, and open dialogs", () => {
  setup();
  const handled = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  handled.preventDefault();
  document.body.dispatchEvent(handled);
  const outside = document.createElement("button");
  document.body.append(outside);
  expect(fireEvent.keyDown(outside, { key: "k", ctrlKey: true })).toBe(true);
  outside.remove();
  const modal = document.createElement("dialog");
  modal.setAttribute("open", "");
  document.body.append(modal);
  expect(fireEvent.keyDown(document.body, { key: "k", ctrlKey: true })).toBe(
    true,
  );
  modal.remove();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["ctrlKey", "metaKey"])(
  "opens once with %s and ignores composition in the palette",
  async (modifier) => {
    setup();
    trigger().focus();
    expect(fireEvent.keyDown(trigger(), { key: "k", [modifier]: true })).toBe(
      false,
    );
    const input = screen.getByRole("combobox", { name: "Find a command" });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent(palette(), new Event("cancel", { cancelable: true }));
    expect(palette()).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    expect(push).not.toHaveBeenCalled();
    fireEvent(palette(), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  },
);

it("supports disable, reload, storage synchronization, and a visible fallback", async () => {
  const user = setup();
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  await user.click(
    screen.getByRole("checkbox", { name: "Enable command shortcut" }),
  );
  expect(window.localStorage.getItem("chronelle.command-shortcut")).toBe(
    "disabled",
  );
  await user.click(screen.getByRole("button", { name: "Close commands" }));
  cleanup();
  setup();
  expect(fireEvent.keyDown(document.body, { key: "k", ctrlKey: true })).toBe(
    true,
  );
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent(
    window,
    Object.assign(new Event("storage"), {
      key: "chronelle.command-shortcut",
      newValue: null,
      storageArea: window.localStorage,
    }),
  );
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(results().getAllByRole("option")).toHaveLength(3);
});

it("retains a page-only setting when storage writes fail", async () => {
  const user = setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Close commands" }));
  expect(fireEvent.keyDown(document.body, { key: "k", ctrlKey: true })).toBe(
    true,
  );
  await user.click(trigger());
  expect(palette()).toBeInTheDocument();
});

it("shares component settings immediately and resets only keyboard preferences", async () => {
  const user = setup();
  window.localStorage.setItem("chronelle.palette", "neutral");
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  const select = screen.getByLabelText("Add component shortcut");
  await user.selectOptions(select, "modified-slash");
  expect(screen.getByLabelText("Component binding")).toHaveTextContent(
    "modified-slash",
  );
  expect(window.localStorage.getItem("chronelle.component-shortcut")).toBe(
    "modified-slash",
  );
  await user.selectOptions(select, "disabled");
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: "Reset keyboard shortcuts" }),
  );
  expect(select).toHaveValue("slash");
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(
    window.localStorage.getItem("chronelle.component-shortcut"),
  ).toBeNull();
  expect(window.localStorage.getItem("chronelle.command-shortcut")).toBeNull();
  expect(window.localStorage.getItem("chronelle.palette")).toBe("neutral");
});

it("loads saved component settings and synchronizes storage updates and clear", () => {
  window.localStorage.setItem("chronelle.component-shortcut", "disabled");
  setup();
  const output = screen.getByLabelText("Component binding");
  expect(output).toHaveTextContent("disabled");
  function change(
    key: string | null,
    newValue: string | null,
    storageArea = window.localStorage,
  ) {
    if (storageArea === window.localStorage) {
      if (key === null) window.localStorage.clear();
      else if (newValue === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, newValue);
    }
    fireEvent(
      window,
      Object.assign(new Event("storage"), { key, newValue, storageArea }),
    );
  }
  change("unrelated", "modified-slash");
  change("chronelle.component-shortcut", "modified-slash", {} as Storage);
  expect(output).toHaveTextContent("disabled");
  change("chronelle.component-shortcut", "modified-slash");
  expect(output).toHaveTextContent("modified-slash");
  change(null, null);
  expect(output).toHaveTextContent("slash");
});

it.each(["unrecognized", null])(
  "uses a default for unreadable or unknown component settings: %s",
  (value) => {
    if (value)
      window.localStorage.setItem("chronelle.component-shortcut", value);
    else
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
    setup();
    expect(screen.getByLabelText("Component binding")).toHaveTextContent(
      "slash",
    );
  },
);

it("keeps component settings across dialog remounts when storage is blocked", async () => {
  const user = setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  await user.selectOptions(
    screen.getByLabelText("Add component shortcut"),
    "disabled",
  );
  await user.click(screen.getByRole("button", { name: "Close commands" }));
  expect(screen.getByLabelText("Component binding")).toHaveTextContent(
    "disabled",
  );
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  expect(screen.getByLabelText("Add component shortcut")).toHaveValue(
    "disabled",
  );
});

it("reads updated storage after all preference consumers remount", () => {
  setup();
  expect(screen.getByLabelText("Component binding")).toHaveTextContent("slash");
  cleanup();
  window.localStorage.setItem("chronelle.component-shortcut", "disabled");
  setup();
  expect(screen.getByLabelText("Component binding")).toHaveTextContent(
    "disabled",
  );
});

it.each(["Expire session", "Switch workspace", "Replace identity"])(
  "closes on %s",
  async (action) => {
    const user = setup();
    await user.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

it("closes only on a full backdrop press", async () => {
  const user = setup();
  await user.click(trigger());
  fireEvent.pointerDown(
    screen.getByRole("combobox", { name: "Find a command" }),
  );
  fireEvent.pointerUp(palette());
  expect(palette()).toBeInTheDocument();
  fireEvent.pointerDown(palette());
  fireEvent.pointerUp(palette());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "../components/workspace-header";
import { AuthSessionProvider, useAuthSession } from "../lib/auth-session";
import { useComponentShortcut } from "../lib/use-component-shortcut";
import {
  CommandScope,
  WorkspaceCommandProvider,
  type ContextCommand,
} from "../components/context-commands";
import { WorkspaceCommands } from "../components/workspace-commands";

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
  delete document.documentElement.dataset.commandShortcut;
  delete document.documentElement.dataset.editorShortcut;
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
const results = () => within(screen.getByRole("listbox", { name: "Commands" }));

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
  expect(
    screen.getByRole("checkbox", { name: "Enable command shortcut" }),
  ).not.toBeChecked();
  window.localStorage.removeItem("chronelle.command-shortcut");
  fireEvent(
    window,
    Object.assign(new Event("storage"), {
      key: "chronelle.command-shortcut",
      newValue: null,
      storageArea: window.localStorage,
    }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Enable command shortcut" }),
  ).toBeChecked();
  expect(results().getAllByRole("option")).toHaveLength(3);
});

it("retains a page-only setting when storage writes fail", async () => {
  const user = setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await user.click(trigger());
  await user.click(screen.getByText("Keyboard shortcuts"));
  await user.click(
    screen.getByRole("checkbox", { name: "Enable command shortcut" }),
  );
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
  await user.click(
    screen.getByRole("checkbox", { name: "Enable command shortcut" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Enable editor submit shortcut" }),
  );
  expect(window.localStorage.getItem("chronelle.editor-shortcut")).toBe(
    "disabled",
  );
  await user.click(
    screen.getByRole("button", { name: "Reset keyboard shortcuts" }),
  );
  expect(select).toHaveValue("slash");
  expect(
    screen.getByRole("checkbox", { name: "Enable command shortcut" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Enable editor submit shortcut" }),
  ).toBeChecked();
  expect(window.localStorage.getItem("chronelle.editor-shortcut")).toBeNull();
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

interface OwnerProps {
  readonly editable?: boolean;
  readonly disabled?: boolean;
  readonly hidden?: boolean;
  readonly onEdit?: () => void;
  readonly onHistory?: () => void;
}

function CommandOwner({
  editable = true,
  disabled = false,
  hidden = false,
  onEdit,
  onHistory,
}: OwnerProps) {
  const edit = useRef<HTMLButtonElement>(null);
  const history = useRef<HTMLButtonElement>(null);
  const commands: ContextCommand[] = [
    {
      id: "event-history",
      label: "Event history",
      description: "Review Gathering",
      target: history,
    },
  ];
  if (editable)
    commands.push({
      id: "edit-event",
      label: "Edit event",
      description: "Edit Gathering",
      target: edit,
    });
  return (
    <>
      <CommandScope pathname="/events/gathering" commands={commands} />
      <fieldset disabled={disabled} hidden={hidden}>
        {editable && (
          <button ref={edit} type="button" onClick={onEdit}>
            Edit event
          </button>
        )}
        <button ref={history} type="button" onClick={onHistory}>
          History
        </button>
      </fieldset>
    </>
  );
}

function ContextHarness({
  pathname = "/events/gathering",
  mounted = true,
  ...owner
}: OwnerProps & { readonly pathname?: string; readonly mounted?: boolean }) {
  return (
    <StrictMode>
      <AuthSessionProvider>
        <WorkspaceCommandProvider pathname={pathname}>
          <Harness />
          {mounted && <CommandOwner {...owner} />}
        </WorkspaceCommandProvider>
      </AuthSessionProvider>
    </StrictMode>
  );
}

it("groups current controls and hands focus to the latest existing handler after closing", async () => {
  const previous = vi.fn();
  const latest = vi.fn(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit event" })).toHaveFocus();
  });
  const view = render(<ContextHarness onEdit={previous} />);
  const user = userEvent.setup();
  await user.click(trigger());
  expect(
    within(screen.getByRole("group", { name: "Event actions" })).getAllByRole(
      "option",
    ),
  ).toHaveLength(2);
  expect(
    within(screen.getByRole("group", { name: "Navigation" })).getAllByRole(
      "option",
    ),
  ).toHaveLength(3);
  view.rerender(<ContextHarness onEdit={latest} />);
  await user.type(
    screen.getByRole("combobox", { name: "Find a command" }),
    "edit gathering",
  );
  await user.keyboard("{Enter}");
  expect(latest).toHaveBeenCalledTimes(1);
  expect(previous).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

it("does not replace a removed selection with another action", async () => {
  const edit = vi.fn();
  const history = vi.fn();
  const view = render(<ContextHarness onEdit={edit} onHistory={history} />);
  const user = userEvent.setup();
  await user.click(trigger());
  expect(results().getByRole("option", { selected: true })).toHaveTextContent(
    "Edit event",
  );
  view.rerender(<ContextHarness editable={false} onHistory={history} />);
  expect(
    screen.getByRole("combobox", { name: "Find a command" }),
  ).not.toHaveAttribute("aria-activedescendant");
  await user.keyboard("{Enter}");
  expect(palette()).toBeInTheDocument();
  expect(edit).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(history).toHaveBeenCalledTimes(1);
});

it("keeps the selected command when an earlier option is inserted", async () => {
  const history = vi.fn();
  const view = render(<ContextHarness editable={false} onHistory={history} />);
  const user = userEvent.setup();
  await user.click(trigger());
  view.rerender(<ContextHarness onHistory={history} />);
  expect(results().getByRole("option", { selected: true })).toHaveTextContent(
    "Event history",
  );
  await user.keyboard("{Enter}");
  expect(history).toHaveBeenCalledTimes(1);
});

it.each([{ pathname: "/search" }, { mounted: false }])(
  "drops context after %j while Commands remains open",
  async (props) => {
    const view = render(<ContextHarness />);
    const user = userEvent.setup();
    await user.click(trigger());
    view.rerender(<ContextHarness {...props} />);
    expect(
      screen.queryByRole("group", { name: "Event actions" }),
    ).not.toBeInTheDocument();
    expect(results().getAllByRole("option")).toHaveLength(3);
    await user.keyboard("{Enter}");
    expect(push).not.toHaveBeenCalled();
  },
);

it.each(["disabled", "hidden", "inert", "disconnected"])(
  "rejects a %s target even if its descriptor remains available",
  async (state) => {
    const edit = vi.fn();
    render(<ContextHarness onEdit={edit} />);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Edit event" });
    const parent = button.parentElement;
    await user.click(trigger());
    if (state === "disconnected") button.remove();
    else parent?.setAttribute(state, "");
    await user.click(results().getByRole("option", { name: /Edit event/ }));
    expect(edit).not.toHaveBeenCalled();
    // Restore ownership before React unmounts this fixture.
    if (state === "disconnected") parent?.prepend(button);
  },
);

it("invalidates an old action when its route changes during dialog dismissal", async () => {
  const edit = vi.fn();
  function DismissingHarness() {
    const [open, setOpen] = useState(false);
    const [pathname, setPathname] = useState("/events/gathering");
    return (
      <WorkspaceCommandProvider pathname={pathname}>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <CommandOwner onEdit={edit} />
        {open && (
          <WorkspaceCommands
            workspaceName="Personal"
            shortcutEnabled
            onShortcutChange={() => {}}
            onClose={() => {
              setOpen(false);
              setPathname("/search");
            }}
          />
        )}
      </WorkspaceCommandProvider>
    );
  }
  render(
    <AuthSessionProvider>
      <DismissingHarness />
    </AuthSessionProvider>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Open" }));
  await userEvent
    .setup()
    .click(results().getByRole("option", { name: /Edit event/ }));
  expect(edit).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

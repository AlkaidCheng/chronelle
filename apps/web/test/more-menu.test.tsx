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
import { MoreMenu } from "../components/more-menu";
import { NoticesProvider } from "../components/notices";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  for (const name of ["appearance", "palette", "density", "motion"])
    delete document.documentElement.dataset[name];
});

function renderMenu() {
  const onCustomize = vi.fn();
  render(
    <NoticesProvider>
      <MoreMenu onCustomize={onCustomize} />
      <button type="button">Elsewhere</button>
    </NoticesProvider>,
  );
  return {
    onCustomize,
    trigger: screen.getByRole("button", { name: "More" }),
    user: userEvent.setup(),
  };
}

it("opens a menu with Trash, Theme, Customize sidebar, Keyboard shortcuts, and Help, and starts customizing", async () => {
  const { onCustomize, trigger, user } = renderMenu();
  await user.click(trigger);
  const menu = screen.getByRole("menu", { name: "More" });
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual([
    "Trash",
    "Theme",
    "Customize sidebar",
    "Keyboard shortcuts",
    "Help",
  ]);
  expect(within(menu).getByRole("menuitem", { name: "Trash" })).toHaveAttribute(
    "href",
    "/trash",
  );
  expect(within(menu).getByRole("menuitem", { name: "Trash" })).toHaveFocus();
  // Keyboard shortcuts and Help have no surface yet: choosing one closes
  // the menu and says so in a passing notice.
  await user.keyboard("{End}");
  expect(within(menu).getByRole("menuitem", { name: "Help" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Help is not available yet",
  );
  expect(onCustomize).not.toHaveBeenCalled();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Customize sidebar" }));
  expect(onCustomize).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("opens the Theme panel from the menu with the mode, palette, density, and motion choices", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Theme" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const panel = screen.getByRole("dialog", { name: "Theme" });
  expect(panel).toBeVisible();
  expect(within(panel).queryByRole("group", { name: "Language" })).toBeNull();
  const mode = within(screen.getByRole("group", { name: "Appearance" }));
  expect(mode.getByRole("radio", { name: "System" })).toHaveFocus();
  await user.click(screen.getByRole("radio", { name: "Celadon" }));
  expect(document.documentElement.dataset.palette).toBe("celadon");
  await user.click(screen.getByRole("radio", { name: "Compact" }));
  expect(document.documentElement.dataset.density).toBe("compact");
  await user.click(
    within(screen.getByRole("group", { name: "Motion" })).getByRole("radio", {
      name: "Reduced",
    }),
  );
  expect(document.documentElement.dataset.motion).toBe("reduced");
  await user.click(mode.getByRole("radio", { name: "Dark" }));
  expect(document.documentElement.dataset.appearance).toBe("dark");
  await user.click(
    screen.getByRole("button", { name: "Reset display settings" }),
  );
  expect(document.documentElement.dataset.palette).toBe("paper");
  expect(document.documentElement.dataset.density).toBe("comfortable");
  expect(document.documentElement.dataset.appearance).toBe("system");
});

it("closes the menu or the panel on Escape with focus back on More, or on an outside press", async () => {
  const { trigger, user } = renderMenu();
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Theme" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Theme" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

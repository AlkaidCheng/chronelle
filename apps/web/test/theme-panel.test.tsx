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
import { ThemePanel } from "../components/theme-panel";

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

it("opens the panel with the mode, palette, density, and motion choices", async () => {
  const user = userEvent.setup();
  render(<ThemePanel />);
  const trigger = screen.getByRole("button", { name: "Theme" });
  await user.click(trigger);
  const panel = screen.getByRole("dialog", { name: "Theme" });
  expect(panel).toBeVisible();
  const mode = within(screen.getByRole("group", { name: "Appearance" }));
  expect(mode.getByRole("radio", { name: "System" })).toBeChecked();
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

it("closes on Escape and returns focus to the entry, or on an outside press", async () => {
  const user = userEvent.setup();
  render(
    <>
      <ThemePanel />
      <button type="button">Elsewhere</button>
    </>,
  );
  const trigger = screen.getByRole("button", { name: "Theme" });
  await user.click(trigger);
  expect(
    within(screen.getByRole("group", { name: "Appearance" })).getByRole(
      "radio",
      { name: "System" },
    ),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

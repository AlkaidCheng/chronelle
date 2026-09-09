// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppearanceControl } from "../components/appearance-control";
import {
  appearanceBootstrap,
  appearanceStorageKey,
  parseAppearance,
} from "../lib/appearance-preference";

beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.appearance;
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.remove();
  });
});

it.each([null, undefined, "system", "sepia", {}, "<script>"])(
  "defaults unsupported preference %j to system",
  (value) => expect(parseAppearance(value)).toBe("system"),
);

it.each(["light", "dark"])("bootstraps saved %s before rendering", (value) => {
  window.localStorage.setItem(appearanceStorageKey, value);
  new Function(appearanceBootstrap)();
  expect(document.documentElement.dataset.appearance).toBe(value);
  render(<AppearanceControl />);
  expect(
    screen.getByRole("radio", { name: value === "light" ? "Light" : "Dark" }),
  ).toBeChecked();
});

it("synchronizes controls and resets persistence when System is selected", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <div>
      <section aria-label="First control">
        <AppearanceControl />
      </section>
      <AppearanceControl />
    </div>,
  );
  const control = within(
    within(container).getByRole("region", { name: "First control" }),
  );
  await user.click(control.getByRole("radio", { name: "Dark" }));
  for (const radio of screen.getAllByRole("radio", { name: "Dark" }))
    expect(radio).toBeChecked();
  expect(window.localStorage.getItem(appearanceStorageKey)).toBe("dark");
  await user.click(control.getByRole("radio", { name: "System" }));
  expect(window.localStorage.getItem(appearanceStorageKey)).toBeNull();
  expect(document.documentElement.dataset.appearance).toBe("system");
});

it("keeps the current page usable when storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => new Function(appearanceBootstrap)()).not.toThrow();
  const user = userEvent.setup();
  render(<AppearanceControl />);
  await user.click(screen.getByRole("radio", { name: "Dark" }));
  expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(document.documentElement.dataset.appearance).toBe("dark");
});

it("accepts cross-tab changes and falls back to System after invalidation", () => {
  render(<AppearanceControl />);
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: appearanceStorageKey,
        newValue: "light",
      }),
    ),
  );
  expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "other", newValue: "dark" }),
    ),
  );
  expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: appearanceStorageKey,
        newValue: "invalid",
      }),
    ),
  );
  expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
});

it("overrides and restores the browser chrome media queries", async () => {
  for (const mode of ["light", "dark"]) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.media = `(prefers-color-scheme: ${mode})`;
    document.head.append(meta);
  }
  const user = userEvent.setup();
  render(<AppearanceControl />);
  await user.click(screen.getByRole("radio", { name: "Dark" }));
  const metas = document.head.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  expect([...metas].map((meta) => meta.media)).toEqual(["not all", "all"]);
  await user.click(screen.getByRole("radio", { name: "System" }));
  expect([...metas].map((meta) => meta.media)).toEqual([
    "(prefers-color-scheme: light)",
    "(prefers-color-scheme: dark)",
  ]);
});

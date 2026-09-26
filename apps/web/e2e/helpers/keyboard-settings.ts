import { expect, type Locator, type Page } from "@playwright/test";

/** The Keyboard section of Settings, where the shortcut preferences live. */
export const keyboardSection = (page: Page) =>
  page.getByRole("region", { name: "Keyboard", exact: true });

/** Whether the page runs on a device with a keyboard, as the app decides it. */
export const isKeyboardDevice = (page: Page) =>
  page.evaluate(
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );

export interface KeyboardPreferences {
  readonly command?: "enabled" | "disabled";
  readonly component?: "slash" | "modified-slash" | "disabled";
  readonly editor?: "enabled" | "disabled";
}

/**
 * Opens Settings at Keyboard over the page the journey is on, by its
 * address: the sandbox keeps the address in the fragment, the app in the
 * path and query.
 */
async function openKeyboardSettings(page: Page) {
  const url = new URL(page.url());
  if (url.protocol === "file:") {
    const address = new URL(
      url.hash.slice(1) || "/events",
      "https://sandbox.invalid",
    );
    address.searchParams.set("settings", "keyboard");
    await page.evaluate((target) => {
      window.location.hash = target;
    }, `${address.pathname}${address.search}`);
  } else {
    url.searchParams.set("settings", "keyboard");
    await page.goto(url.href);
  }
}

/**
 * Sets the shortcut preferences and returns to the page the journey was
 * on. On a keyboard device this goes through Settings > Keyboard (the only
 * surface that offers them), opened over the page and closed again, with
 * `inSettings` run there first for extra assertions or screenshots; on a
 * touch device, which has no such section, the browser-kept values are
 * written directly, as the app would keep them from a keyboard session on
 * the same browser. "reset" restores the defaults either way.
 */
export async function setKeyboardPreferences(
  page: Page,
  preferences: KeyboardPreferences | "reset",
  inSettings?: (section: Locator) => Promise<void>,
) {
  if (!(await isKeyboardDevice(page))) {
    await page.evaluate((next) => {
      const keys = {
        command: "chronelle.command-shortcut",
        component: "chronelle.component-shortcut",
        editor: "chronelle.editor-shortcut",
      } as const;
      const defaults = {
        command: "enabled",
        component: "slash",
        editor: "enabled",
      } as const;
      for (const name of ["command", "component", "editor"] as const) {
        const value = next === "reset" ? defaults[name] : next[name];
        if (value === undefined) continue;
        if (value === defaults[name]) localStorage.removeItem(keys[name]);
        else localStorage.setItem(keys[name], value);
        window.dispatchEvent(new Event(`livtales:${name}-shortcut`));
      }
    }, preferences);
    return;
  }
  await openKeyboardSettings(page);
  const section = keyboardSection(page);
  await expect(section.getByRole("table")).toBeVisible();
  if (inSettings) await inSettings(section);
  if (preferences === "reset") {
    await section
      .getByRole("button", { name: "Reset keyboard shortcuts" })
      .click();
  } else {
    if (preferences.command !== undefined)
      await section
        .getByRole("switch", { name: "Open Search", exact: true })
        .setChecked(preferences.command === "enabled");
    if (preferences.component !== undefined)
      await section
        .getByRole("combobox", { name: "Add a component", exact: true })
        .selectOption(preferences.component);
    if (preferences.editor !== undefined)
      await section
        .getByRole("switch", { name: "Submit an editor", exact: true })
        .setChecked(preferences.editor === "enabled");
  }
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settings).toHaveCount(0);
}

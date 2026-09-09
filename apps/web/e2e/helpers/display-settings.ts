import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectReadablePalette } from "./appearance";
import { openWorkspaceSettings } from "./workspace-utilities";

export async function openDisplaySettings(page: Page) {
  const trigger = page.getByRole("button", { name: "Customize appearance" });
  if (!(await trigger.isVisible())) await openWorkspaceSettings(page);
  await trigger.click();
  return page.getByRole("dialog", { name: "Appearance", exact: true });
}

export async function exerciseDisplaySettings(page: Page, testInfo: TestInfo) {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  let dialog = await openDisplaySettings(page);
  await dialog.getByRole("radio", { name: /Ink & Paper/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: /Celadon/ })).toBeChecked();
  for (const palette of ["Ink & Paper", "Celadon", "Modern Neutral"]) {
    await dialog.getByRole("radio", { name: new RegExp(palette) }).check();
    for (const mode of ["Dark", "Light"]) {
      await dialog.getByRole("radio", { name: mode, exact: true }).check();
      await expect(page.locator("html")).toHaveCSS(
        "color-scheme",
        mode.toLowerCase(),
      );
      await expectReadablePalette(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `${palette.toLowerCase().replaceAll(" ", "-")}-${mode.toLowerCase()}.png`,
        ),
      });
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await dialog.getByRole("radio", { name: /^Compact/ }).check();
  await dialog.getByRole("radio", { name: /^Reduced/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCSS("transition-duration", /^(1e-05|0\.00001)s$/);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Customize appearance" }),
  ).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "neutral");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  dialog = await openDisplaySettings(page);
  await dialog.getByRole("button", { name: "Reset display settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "paper");
  await expect(page.locator("html")).toHaveAttribute(
    "data-density",
    "comfortable",
  );
  await expect(page.locator("html")).toHaveAttribute("data-motion", "system");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toHaveCSS("transition-duration", /^(1e-05|0\.00001)s$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

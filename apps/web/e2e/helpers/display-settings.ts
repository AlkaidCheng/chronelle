import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectReadablePalette } from "./appearance";
import { moreControl, openThemePanel } from "./quiet-chrome";

/** The palette, appearance, density, and motion choices of the rail's Theme panel. */
export async function exerciseThemePanel(page: Page, testInfo: TestInfo) {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  let panel = await openThemePanel(page);
  const mode = (name: string) =>
    panel
      .getByRole("group", { name: "Appearance" })
      .getByRole("radio", { name, exact: true });
  await panel.getByRole("radio", { name: /Ink & Paper/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("radio", { name: /Celadon/ })).toBeChecked();
  for (const palette of ["Ink & Paper", "Celadon", "Modern Neutral"]) {
    await panel.getByRole("radio", { name: new RegExp(palette) }).check();
    for (const appearance of ["Dark", "Light"]) {
      await mode(appearance).check();
      await expect(page.locator("html")).toHaveCSS(
        "color-scheme",
        appearance.toLowerCase(),
      );
      await expectReadablePalette(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `${palette.toLowerCase().replaceAll(" ", "-")}-${appearance.toLowerCase()}.png`,
        ),
      });
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await panel.getByRole("radio", { name: /^Compact/ }).check();
  await panel
    .getByRole("group", { name: "Motion" })
    .getByRole("radio", { name: "Reduced", exact: true })
    .check();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(
    panel.getByRole("button", { name: "Reset display settings" }),
  ).toHaveCSS("transition-duration", /^(1e-05|0\.00001)s$/);
  await page.keyboard.press("Escape");
  await expect(moreControl(page)).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "neutral");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  panel = await openThemePanel(page);
  await panel.getByRole("button", { name: "Reset display settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "paper");
  await expect(page.locator("html")).toHaveAttribute(
    "data-density",
    "comfortable",
  );
  await expect(page.locator("html")).toHaveAttribute("data-motion", "system");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

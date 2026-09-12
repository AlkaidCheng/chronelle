import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { selectLeapDayRange } from "./calendar-keyboard";

export async function expectReadablePalette(page: Page) {
  const checks = await page.evaluate(() => {
    function luminance(token: string) {
      const probe = document.createElement("span");
      probe.style.color = `var(--${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      const channels = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1);
      if (!channels) throw new Error(`${token}: ${color}`);
      const [r = 0, g = 0, b = 0] = channels.map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    }
    const pairs: [string, string, number][] = [];
    for (const background of ["canvas", "surface", "surface-subtle"]) {
      for (const foreground of ["ink", "muted", "accent"])
        pairs.push([foreground, background, 4.5]);
      for (const foreground of ["line-strong", "focus"])
        pairs.push([foreground, background, 3]);
    }
    pairs.push(
      ["accent", "accent-soft", 4.5],
      ["muted", "accent-soft", 4.5],
      ["on-accent", "accent", 4.5],
      ["on-accent", "accent-hover", 4.5],
      ["danger", "danger-soft", 4.5],
      ["warning", "warning-soft", 4.5],
    );
    return pairs.map(([foreground, background, minimum]) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return {
        foreground,
        background,
        minimum,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  for (const check of checks)
    expect(
      check.ratio,
      `${check.foreground} on ${check.background}`,
    ).toBeGreaterThanOrEqual(check.minimum);
}

export async function expectToken(
  locator: Locator,
  property: string,
  token: string,
) {
  const color = await locator.evaluate((element, name) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.color = style.getPropertyValue(`--${name}`);
    probe.style.colorScheme = style.colorScheme;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, token);
  await expect(locator).toHaveCSS(property, color);
}

export async function exerciseAppearance(
  page: Page,
  testInfo: TestInfo,
  appearance: "light" | "dark",
) {
  await expect(page.locator("html")).toHaveCSS("color-scheme", appearance);
  await expectReadablePalette(page);
  await page.screenshot({
    path: testInfo.outputPath("events.png"),
  });
  const trigger = page.getByRole("button", { name: "New event", exact: true });
  await expectToken(trigger, "color", "on-accent");
  await expectToken(page.locator("html"), "background-color", "canvas");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await expectToken(dialog, "background-color", "surface");
  const name = dialog.getByLabel("Event name", { exact: true });
  const title =
    "\u6c5f\u5357\u590f\u65e5\u8bb0\u884c / A summer of quiet gardens and long conversations";
  await expect(name).toBeFocused();
  await name.fill(title);
  await expect(name).toHaveCSS("outline-style", "solid");
  await expect(name).toHaveCSS("outline-width", "3px");
  await expectToken(name, "outline-color", "focus");
  await expectToken(name, "color", "ink");
  await selectLeapDayRange(page);
  const selectedDate = dialog
    .locator('.calendar-grid button[aria-pressed="true"]')
    .first();
  await expectToken(selectedDate, "background-color", "accent");
  await expectToken(selectedDate, "color", "on-accent");
  await page.screenshot({
    path: testInfo.outputPath("create-event.png"),
  });
  await page.emulateMedia({
    colorScheme: appearance === "light" ? "dark" : "light",
  });
  await expect(name).toHaveValue(title);
  await expect(
    dialog.getByRole("button", { name: "End date: Mar 1, 2028" }),
  ).toBeVisible();
  await expectReadablePalette(page);
  await page.emulateMedia({ colorScheme: appearance });
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Browse event data" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("event.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await exerciseAppearanceControl(page, appearance);
}

async function exerciseAppearanceControl(
  page: Page,
  appearance: "light" | "dark",
) {
  const opposite = appearance === "light" ? "dark" : "light";
  async function choose(name: string) {
    const group = page.getByRole("group", { name: "Appearance" });
    if (!(await group.isVisible()))
      await page.getByRole("button", { name: "More", exact: true }).click();
    await group.getByRole("radio", { name, exact: true }).check();
  }
  await choose(opposite === "dark" ? "Dark" : "Light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", opposite);
  await expectReadablePalette(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Browse event data" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", opposite);
  await choose(appearance === "light" ? "Light" : "Dark");
  await page.emulateMedia({ colorScheme: opposite });
  await expect(page.locator("html")).toHaveCSS("color-scheme", appearance);
  await choose("System");
  await expect(page.locator("html")).toHaveCSS("color-scheme", opposite);
  await page.emulateMedia({ colorScheme: appearance });
  await expect(page.locator("html")).toHaveCSS("color-scheme", appearance);
  await page.keyboard.press("Escape");
}

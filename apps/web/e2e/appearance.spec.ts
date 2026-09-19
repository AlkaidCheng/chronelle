import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { exerciseAppearance } from "./helpers/appearance";
import { exerciseThemePanel } from "./helpers/display-settings";
import { openThemePanel } from "./helpers/quiet-chrome";

const signIn = async (page: Page, name: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(`${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("customizes palettes, density, and motion independently @webkit-desktop @webkit-mobile", async ({
  page,
}, testInfo) => {
  await signIn(page, "Appearance planner");
  await exerciseThemePanel(page, testInfo);
});

test("preserves an underlying form and applies another tab's palette and density @webkit-desktop @webkit-mobile", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in/development");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill("Retained sign-in draft");
  const other = await context.newPage();
  await signIn(other, "Appearance planner");
  const panel = await openThemePanel(other);
  await panel.getByRole("radio", { name: /^Compact/ }).check();
  await panel.getByRole("radio", { name: /Modern Neutral/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "neutral");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Retained sign-in draft",
  );
  const canvas = await page
    .locator("html")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(
    page.locator('meta[name="theme-color"][media="all"]'),
  ).toHaveAttribute("content", canvas);
  await other.close();
});

for (const appearance of ["light", "dark"] as const) {
  test(`keeps the Event journey readable in ${appearance} appearance @webkit-desktop @webkit-mobile`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({
      colorScheme: appearance,
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/sign-in/development");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeEnabled();
    const canvas = await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(
      page.locator('meta[name="theme-color"][media="all"]'),
    ).toHaveAttribute("content", canvas);
    await page.getByLabel("Name", { exact: true }).fill("Event planner");
    await page
      .getByLabel("Email")
      .fill(`appearance-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await exerciseAppearance(page, testInfo, appearance);
    expect(errors).toEqual([]);
  });
}

test("applies a saved appearance before application JavaScript loads @webkit-desktop @webkit-mobile", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("chronelle.appearance", "dark");
    localStorage.setItem("chronelle.palette", "celadon");
    localStorage.setItem("chronelle.density", "compact");
    localStorage.setItem("chronelle.motion", "reduced");
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, (route) => route.abort());
  await page.goto("/sign-in/development");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  // The footer's theme menu is in the server markup, before any script.
  await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "celadon");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});

test("synchronizes the theme menu across tabs @webkit-desktop @webkit-mobile", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in/development");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  const other = await context.newPage();
  await other.goto("/sign-in/development");
  await expect(
    other.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  const theme = page.getByRole("combobox", { name: "Theme" });
  await theme.selectOption("light");
  await expect(other.getByRole("combobox", { name: "Theme" })).toHaveValue(
    "light",
  );
  await theme.selectOption("dark");
  await expect(other.locator("html")).toHaveCSS("color-scheme", "dark");
  await other.getByRole("combobox", { name: "Theme" }).selectOption("system");
  await expect(theme).toHaveValue("system");
  await other.close();
});

test("falls back from invalid storage and allows a page-only override when writes fail @webkit-desktop @webkit-mobile", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("chronelle.appearance", "unsupported");
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "chronelle.appearance") throw new Error("Storage blocked");
      setItem.call(this, key, value);
    };
  });
  await page.goto("/sign-in/development");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});

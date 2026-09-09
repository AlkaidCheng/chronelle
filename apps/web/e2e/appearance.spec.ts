import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exerciseAppearance } from "./helpers/appearance";
import {
  exerciseDisplaySettings,
  openDisplaySettings,
} from "./helpers/display-settings";

test("customizes palettes, density, and motion independently", async ({
  page,
}, testInfo) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill("Retained sign-in draft");
  await exerciseDisplaySettings(page, testInfo);
});

test("preserves an underlying form and applies other-tab palette changes with settings closed", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill("Retained sign-in draft");
  const dialog = await openDisplaySettings(page);
  await dialog.getByRole("radio", { name: /Celadon/ }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Retained sign-in draft",
  );
  const other = await context.newPage();
  await other.goto("/sign-in");
  const settings = await openDisplaySettings(other);
  await settings.getByRole("radio", { name: /^Compact/ }).check();
  await settings.getByRole("radio", { name: /Modern Neutral/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "neutral");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  const canvas = await page
    .locator("html")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(
    page.locator('meta[name="theme-color"][media="all"]'),
  ).toHaveAttribute("content", canvas);
  await other.close();
});

for (const appearance of ["light", "dark"] as const) {
  test(`keeps the Event journey readable in ${appearance} appearance`, async ({
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
    await page.goto("/sign-in");
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

test("applies a saved appearance before application JavaScript loads", async ({
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
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "celadon");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});

test("supports keyboard selection and synchronizes appearance across tabs", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  const other = await context.newPage();
  await other.goto("/sign-in");
  await expect(
    other.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await page.getByRole("radio", { name: "System", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Light", exact: true }),
  ).toBeChecked();
  await expect(
    other.getByRole("radio", { name: "Light", exact: true }),
  ).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await expect(other.locator("html")).toHaveCSS("color-scheme", "dark");
  await other.getByRole("radio", { name: "System", exact: true }).check();
  await expect(
    page.getByRole("radio", { name: "System", exact: true }),
  ).toBeChecked();
  await other.close();
});

test("falls back from invalid storage and allows a page-only override when writes fail", async ({
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
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});

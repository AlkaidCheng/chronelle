import { expect, test } from "@playwright/test";

test("creates and retrieves one canonical Event at responsive widths", async ({
  page,
}, testInfo) => {
  const projectLabel = testInfo.project.name.replace("chromium-", "");
  const eventName = `${projectLabel} launch plan`;

  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(`${projectLabel} planner`);
  await page.getByLabel("Email").fill(`${projectLabel}-planner@example.test`);
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/events$/u);

  await page.getByLabel("Event name").fill(eventName);
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
  const eventUrl = page.url();
  expect(eventUrl).toMatch(/\/events\/[0-9a-f-]+$/u);

  const overviewTab = page.getByRole("tab", { name: "Overview" });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "To-dos" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Keywords").fill("launch plan");
  await page.getByRole("button", { name: "Search" }).click();
  const result = page.getByRole("link", { name: new RegExp(eventName, "u") });
  await expect(result).toHaveAttribute("href", new URL(eventUrl).pathname);

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await result.click();
  await expect(page).toHaveURL(eventUrl);
  await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
});

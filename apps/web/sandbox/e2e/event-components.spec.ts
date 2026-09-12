import { expect, test } from "@playwright/test";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("inserts mixed components offline and edits one schedule across three projections", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByLabel("Page name").fill("On the day");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  for (const label of [
    "Calendar",
    "Itinerary",
    "Timeline",
    "Expenses",
    "Reminders",
    "Files",
    "To-dos",
  ]) {
    await page
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add a component" });
    await expect(
      dialog.getByRole("searchbox", { name: "Find a component" }),
    ).toBeFocused();
    await dialog.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
    if (label === "Calendar") {
      await expect(
        dialog.getByRole("button", { name: "Add Calendar", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath("component-picker.png"),
      });
    }
    await dialog
      .getByRole("button", { name: `Add ${label}`, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }
  const calendar = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Calendar", exact: true }),
  });
  await calendar.getByRole("button", { name: "Edit", exact: true }).click();
  const inspector = page.getByRole("dialog", { name: "Edit schedule item" });
  await inspector.getByLabel("Name", { exact: true }).fill("Garden welcome");
  await inspector
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Garden welcome", exact: true }),
  ).toHaveCount(3);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Garden welcome", exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByText("No files attached", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mixed-components.png"),
    fullPage: true,
  });
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByText("Read-only files", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add component", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

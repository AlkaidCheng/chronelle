import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { expectNoDates } from "./date-rows";
import { expectHorizontalReflow } from "./page-navigation";
import { choosePageOptionWithKeyboard } from "./quiet-chrome";

export async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let index = 0; index < 60; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

export async function activateWithKeyboard(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

export async function createFirstPlan(page: Page, testInfo: TestInfo) {
  await expect(
    page.getByRole("heading", { name: "No events yet" }),
  ).toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "New event", exact: true }),
  );
  const create = page.getByRole("dialog", { name: "Create an event" });
  await expect(create.getByLabel("Event name")).toBeFocused();
  await expectNoDates(create);
  await page.keyboard.insertText("A first gathering");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Add a page", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-date")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set dates", exact: true }),
  ).toBeVisible();
  await expectHorizontalReflow(page);
  const addPage = page.getByRole("button", { name: "Add page", exact: true });
  await tabTo(page, addPage);
  await page.screenshot({
    path: testInfo.outputPath("first-event.png"),
  });

  await activateWithKeyboard(page, addPage);
  const dialog = page.getByRole("dialog", { name: "Add a page" });
  await expect(dialog.getByLabel("Page name")).toHaveAccessibleDescription(
    /Pages organize this event/,
  );
  await page.keyboard.press("Escape");
  await expect(addPage).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Page name")).toBeFocused();
  await page.keyboard.insertText("Preparation");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add component", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composition-hint")).toHaveCount(0);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Add component", exact: true }),
  );
  await expect(page.getByLabel("Find a component")).toBeFocused();
  await page.keyboard.insertText("todos");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "To-dos", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composition-hint")).toHaveCount(0);
  await choosePageOptionWithKeyboard(page, "Arrange components");
  await expect(
    page.getByRole("button", { name: "Done arranging", exact: true }),
  ).toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Done arranging", exact: true }),
  );
  await expect(page.locator(".composition-hint")).toHaveCount(0);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Add a task to the list", exact: true }),
  );
  // The add row opens the composer with the name focused; More at its foot
  // reaches the full editor.
  await expect(page.getByLabel("Task name", { exact: true })).toBeFocused();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: /^More: / }),
  );
  await expect(page.getByLabel("Task", { exact: true })).toBeFocused();
  expect(
    await page.getByLabel("Task", { exact: true }).evaluate((input) => {
      const form = input.closest("form");
      if (!form) throw new Error("Task form is missing.");
      const bounds = form.getBoundingClientRect();
      return Array.from(form.querySelectorAll("input, select, button"))
        .filter((control) => {
          const box = control.getBoundingClientRect();
          return box.left < bounds.left - 1 || box.right > bounds.right + 1;
        })
        .map((control) => control.outerHTML);
    }),
    "Task controls stay within their form at every viewport width",
  ).toEqual([]);
  await page.keyboard.insertText("Invite a friend");
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Create task", exact: true }),
  );
  await expect(
    page.getByRole("row").filter({ hasText: "Invite a friend" }),
  ).toBeVisible();
  await expectHorizontalReflow(page);
  await page.screenshot({
    path: testInfo.outputPath("first-component.png"),
  });
}

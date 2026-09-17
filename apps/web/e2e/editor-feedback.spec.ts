import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("retains a failed task draft and saves only after an explicit retry @webkit-desktop @webkit-mobile", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(`feedback-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Planning review");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const addTask = page.getByRole("button", { name: "Add task", exact: true });
  await addTask.click();
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Task", { exact: true }) });
  await form.getByLabel("Task", { exact: true }).fill("Confirm guests");
  const commands: string[] = [];
  let fail = true;
  let finishSave: (() => void) | undefined;
  await page.route("**/api/events/*/resources", async (route) => {
    commands.push(route.request().postDataJSON().commandId);
    if (fail) {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "service_unavailable",
            message: "Save temporarily unavailable",
          },
        },
      });
      return;
    }
    await new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    await route.continue();
  });
  await form.getByLabel("Task", { exact: true }).press("Control+Enter");
  await expect(form.getByRole("alert")).toContainText(
    "Save temporarily unavailable",
  );
  await expect(form.getByLabel("Task", { exact: true })).toHaveValue(
    "Confirm guests",
  );
  await expect(form.getByText(/Your draft is still here/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("task-save-error.png"),
    fullPage: true,
  });
  expect(commands).toHaveLength(1);
  fail = false;
  const actions = form.locator(".form-actions");
  const actionHeight = await actions.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await form.getByLabel("Task", { exact: true }).press("Meta+Enter");
  await expect(form).toHaveAttribute("aria-busy", "true");
  await expect(form.getByLabel("Task", { exact: true })).toBeDisabled();
  await expect(form.getByRole("status", { name: "Save status" })).toHaveText(
    "Saving changes...",
  );
  await expect.poll(() => finishSave !== undefined).toBe(true);
  expect(
    await actions.evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(actionHeight);
  await form.dispatchEvent("keydown", { key: "Enter", ctrlKey: true });
  expect(commands).toHaveLength(2);
  finishSave?.();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(addTask).toBeFocused();
  await expect(page.getByText("Confirm guests", { exact: true })).toHaveCount(
    1,
  );
  expect(commands).toHaveLength(2);
  expect(commands[0]).toBe(commands[1]);
  await page.screenshot({
    path: testInfo.outputPath("task-save-success.png"),
    fullPage: true,
  });
  await addTask.click();
  await expect(form.getByLabel("Task", { exact: true })).toHaveValue("");
  await form.getByLabel("Task", { exact: true }).fill("Next task");
  await expect(form.getByRole("status", { name: "Save status" })).toBeEmpty();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

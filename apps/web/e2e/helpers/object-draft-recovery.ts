import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectDue, setDue } from "./due-picker";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";

export const planningEditors = {
  task: {
    field: "Task",
    timeLabel: "Due date",
    view: "To-dos",
    projection: "todos",
  },
  expense: {
    field: "Expense",
    timeLabel: "Date",
    view: "Expenses",
    projection: "expenses",
  },
  reminder: {
    field: "Reminder",
    timeLabel: "Reminder time",
    view: "Reminders",
    projection: "reminders",
  },
} as const;

export async function revisitObjectView(page: Page) {
  const url = page.url();
  const length = await page.evaluate(() => history.length);
  await page.goBack();
  await expect(page).not.toHaveURL(url);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => history.length)).toBe(length);
}

export async function exerciseObjectRecovery(
  page: Page,
  testInfo: TestInfo,
  kind: keyof typeof planningEditors,
) {
  const { field, timeLabel, view } = planningEditors[kind];
  const rowRole = kind === "task" ? "row" : "article";

  await page.getByRole("button", { name: "Browse event data" }).click();
  await page
    .getByRole("tab", {
      name: view,
      exact: true,
    })
    .click();
  const add = page.getByRole("button", { name: `Add ${kind}`, exact: true });
  const name = page.getByLabel(field, { exact: true });
  const recovery = page.getByRole("dialog", {
    name: "Resume your draft?",
    exact: true,
  });
  const resume = recovery.getByRole("button", {
    name: "Resume draft",
    exact: true,
  });
  await add.click();
  await name.fill("Pack the lanterns");
  if (kind === "expense") {
    await page.getByLabel("Amount", { exact: true }).fill("-0.0001");
    await page.getByLabel("Currency", { exact: true }).fill("CNY");
  }
  // The task editor takes a date behind its Due control; the others take
  // one instant.
  const timeValue = kind === "task" ? "2030-07-03" : "2030-07-03T11:30";
  if (kind === "task") await setDue(page.getByRole("dialog"), timeValue);
  else await page.getByLabel(timeLabel, { exact: true }).fill(timeValue);
  await revisitObjectView(page);
  await add.click();
  await expect(recovery).toBeVisible();
  await expect(name).toHaveCount(0);
  await expect(resume).toBeFocused();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.locator("html")).toHaveCSS("color-scheme", colorScheme);
    await expectToken(recovery, "background-color", "surface");
    await expectToken(recovery, "color", "ink");
    await expectToken(recovery.getByRole("heading"), "color", "ink");
    await expectToken(recovery.locator(".event-create-body p"), "color", "ink");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expectHorizontalReflow(page);
    await expect(resume).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`${kind}-recovery-${colorScheme}.png`),
    });
  }
  await resume.click();
  await expect(name).toHaveValue("Pack the lanterns");
  await expect(name).toBeFocused();
  if (kind === "task") await expectDue(page.getByRole("dialog"), "Jul 3, 2030");
  else
    await expect(page.getByLabel(timeLabel, { exact: true })).toHaveValue(
      timeValue,
    );
  if (kind === "expense") {
    await expect(page.getByLabel("Amount", { exact: true })).toHaveValue(
      "-0.0001",
    );
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue(
      "CNY",
    );
  }
  if (kind !== "task") {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const editor = page.getByRole("dialog", {
        name: `Add ${kind}`,
        exact: true,
      });
      await expect(page.locator("html")).toHaveCSS("color-scheme", colorScheme);
      await expectToken(editor, "background-color", "surface");
      await expectToken(editor, "color", "ink");
      await expectToken(editor.getByRole("heading"), "color", "ink");
      await expectToken(editor.locator(".field-hint"), "color", "ink");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expectHorizontalReflow(page);
      await expect(
        editor.getByRole("button", { name: `Record ${kind}`, exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`${kind}-editor-${colorScheme}.png`),
      });
    }
  }
  await name.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole(rowRole).filter({ hasText: "Pack the lanterns" });
  await expect(row).toHaveCount(1);
  await expectHorizontalReflow(page);
  const edit = row.getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  await name.fill("Pack the lanterns and candles");
  await revisitObjectView(page);
  await edit.click();
  await expect(recovery).toBeVisible();
  await expect(name).toHaveCount(0);
  await resume.click();
  await expect(name).toHaveValue("Pack the lanterns and candles");
  await expect(name).toBeFocused();
  await name.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await expect(edit).toBeFocused();
  if (kind === "reminder") {
    await row.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(row.getByText("Dismissed", { exact: true })).toBeVisible();
    await edit.click();
    await name.fill("Pack the lanterns and candles tonight");
    await name.press("ControlOrMeta+Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row.getByText("Dismissed", { exact: true })).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Dismiss", exact: true }),
    ).toHaveCount(0);
  }
  await add.click();
  await name.fill("Discard this plan");
  await revisitObjectView(page);
  await add.click();
  await recovery
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await add.click();
  await expect(name).toHaveValue("");
  await name.fill("Reload clears this draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await add.click();
  await expect(name).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page
      .getByRole(rowRole)
      .filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);
}

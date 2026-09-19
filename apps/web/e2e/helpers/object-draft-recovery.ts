import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { expectDue, expectMoment, momentRows, setMoment } from "./date-rows";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";
import { chooseRowAction, rowMenuButton } from "./row-menu";
import { openPlanningEditor } from "./task-add";
import { openEventView } from "./event-view";

export const planningEditors = {
  task: {
    field: "Task",
    timeRow: /^(Set due date|Due date)/,
    view: "To-dos",
    projection: "todos",
  },
  expense: {
    field: "Expense",
    timeRow: momentRows.expense,
    view: "Expenses",
    projection: "expenses",
  },
  reminder: {
    field: "Reminder",
    timeRow: momentRows.reminder,
    view: "Reminders",
    projection: "reminders",
  },
} as const;

/**
 * A task's drafts live in its row's composer: a composer left with text
 * (an add row's, a row's, or the dialog More opens from it) is found open
 * again with the text after leaving the view and coming back; Escape
 * discards it, and a reload clears it.
 */
async function exerciseTaskComposerRecovery(page: Page) {
  await openEventView(page, "Overview");
  await openEventView(page, "To-dos");
  const addRow = page.getByRole("button", {
    name: "Add a task to the list",
    exact: true,
  });
  const adding = page.getByRole("form", { name: "New task", exact: true });
  const name = adding.getByLabel("Task name", { exact: true });
  await addRow.click();
  await name.fill("Pack the lanterns");
  await setDueChip(adding, "2030-07-03");
  await revisitObjectView(page);
  // The composer comes back open with its text and its chip.
  await expect(name).toHaveValue("Pack the lanterns");
  await expect(
    adding.getByRole("button", { name: "Due: Jul 3, 2030", exact: true }),
  ).toBeVisible();
  // More opens the dialog with the composer's fields; leaving the dialog
  // with them keeps the same draft, found in the composer again.
  await adding.getByRole("button", { name: /^More: / }).click();
  const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
  const dialogName = dialog.getByLabel("Task", { exact: true });
  await expect(dialogName).toHaveValue("Pack the lanterns");
  await expectDue(dialog, "Jul 3, 2030");
  await dialogName.fill("Pack the lanterns tonight");
  await revisitObjectView(page);
  await expect(name).toHaveValue("Pack the lanterns tonight");
  await name.press("Enter");
  const row = page.getByRole("row").filter({ hasText: "Pack the lanterns" });
  await expect(row).toHaveCount(1);
  await expect(name).toHaveValue("");
  await name.press("Escape");
  await expect(adding).toHaveCount(0);
  await expectHorizontalReflow(page);

  // A row's composer keeps its text the same way.
  await chooseRowAction(page, row, "Edit");
  const editing = page.getByRole("form", { name: /^Edit Pack the lanterns/ });
  const editingName = editing.getByLabel("Task name", { exact: true });
  await editingName.fill("Pack the lanterns and candles");
  await revisitObjectView(page);
  await expect(editingName).toHaveValue("Pack the lanterns and candles");
  await expect(editingName).toBeFocused();
  await editingName.press("Enter");
  await expect(editing).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);

  // Escape discards a draft; a reload clears one.
  await addRow.click();
  await name.fill("Discard this plan");
  await revisitObjectView(page);
  await expect(name).toHaveValue("Discard this plan");
  await name.press("Escape");
  await expect(adding).toHaveCount(0);
  await addRow.click();
  await expect(name).toHaveValue("");
  await name.fill("Reload clears this draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await addRow.click();
  await expect(name).toHaveValue("");
  await adding.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);
}

/** Types a day into a composer's Due chip and closes its panel. */
async function setDueChip(composer: Locator, day: string) {
  await composer.getByRole("button", { name: /^Due/ }).click();
  const typed = composer.getByLabel("Type a date", { exact: true });
  await typed.fill(day);
  await typed.press("Escape");
  await expect(typed).toHaveCount(0);
}

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
  if (kind === "task") {
    await exerciseTaskComposerRecovery(page);
    return;
  }
  const { field, timeRow, view } = planningEditors[kind];

  await openEventView(page, "Overview");
  await openEventView(page, view);
  const openEditor = () => openPlanningEditor(page, kind);
  const name = page.getByLabel(field, { exact: true });
  const recovery = page.getByRole("dialog", {
    name: "Resume your draft?",
    exact: true,
  });
  const resume = recovery.getByRole("button", {
    name: "Resume draft",
    exact: true,
  });
  await openEditor();
  await name.fill("Pack the lanterns");
  if (kind === "expense") {
    await page.getByLabel("Amount", { exact: true }).fill("-0.0001");
    await page.getByLabel("Currency", { exact: true }).fill("CNY");
  }
  // The editor takes a day and a time on its row.
  await setMoment(page.getByRole("dialog"), timeRow, "2030-07-03", "11:30");
  await revisitObjectView(page);
  await openEditor();
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
  await expectMoment(
    page.getByRole("dialog"),
    timeRow,
    "Jul 3, 2030",
    "11:30 AM",
  );
  if (kind === "expense") {
    await expect(page.getByLabel("Amount", { exact: true })).toHaveValue(
      "-0.0001",
    );
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue(
      "CNY",
    );
  }
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
    await expectToken(
      editor.locator(".field-row-value").first(),
      "color",
      "ink",
    );
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
  await name.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page
    .getByRole("article")
    .filter({ hasText: "Pack the lanterns" });
  await expect(row).toHaveCount(1);
  await expectHorizontalReflow(page);
  // A reminder row keeps Edit in its menu; an expense row shows it.
  const menuButton =
    kind === "expense"
      ? row.getByRole("button", { name: "Edit", exact: true })
      : rowMenuButton(row);
  const edit = async () => {
    if (kind === "expense") await menuButton.click();
    else await chooseRowAction(page, row, "Edit");
  };
  await edit();
  await name.fill("Pack the lanterns and candles");
  await revisitObjectView(page);
  await edit();
  await expect(recovery).toBeVisible();
  await expect(name).toHaveCount(0);
  await resume.click();
  await expect(name).toHaveValue("Pack the lanterns and candles");
  await expect(name).toBeFocused();
  await name.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await expect(menuButton).toBeFocused();
  if (kind === "reminder") {
    // The row shows the rename only once the list has refetched; dismissing
    // before that would send the version the rename already replaced.
    await expect(row.getByRole("heading")).toHaveText(
      "Pack the lanterns and candles",
    );
    await chooseRowAction(page, row, "Dismiss");
    await expect(row.getByText("Dismissed", { exact: true })).toBeVisible();
    await edit();
    await name.fill("Pack the lanterns and candles tonight");
    await name.press("ControlOrMeta+Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row.getByText("Dismissed", { exact: true })).toBeVisible();
    await menuButton.click();
    await expect(
      page.getByRole("menu").getByRole("menuitem", { name: "Dismiss" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await openEditor();
  await name.fill("Discard this plan");
  await revisitObjectView(page);
  await openEditor();
  await recovery
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await openEditor();
  await expect(name).toHaveValue("");
  await name.fill("Reload clears this draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await openEditor();
  await expect(name).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);
}

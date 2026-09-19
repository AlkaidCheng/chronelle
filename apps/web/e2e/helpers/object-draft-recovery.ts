import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { expectToken } from "./appearance";
import { expectDue, expectMoment, momentRows } from "./date-rows";
import { expectHorizontalReflow } from "./page-navigation";
import { chip, setAmountChip, setMomentChip } from "./record-composers";
import { chooseRowAction } from "./row-menu";
import { openEventView } from "./event-view";

/**
 * Each kind's list, its rows, and its composer: the add row's name, the
 * form's name, the name field, the dialog More opens, and its field.
 */
export const planningEditors = {
  task: {
    field: "Task",
    timeRow: /^(Set due date|Due date)/,
    view: "To-dos",
    projection: "todos",
    addRow: "Add a task to the list",
    form: "New task",
    composerField: "Task name",
    dialog: "Add task",
    rowRole: "row",
  },
  expense: {
    field: "Expense",
    timeRow: momentRows.expense,
    view: "Expenses",
    projection: "expenses",
    addRow: "Add expense",
    form: "New expense",
    composerField: "What was paid for",
    dialog: "Add expense",
    rowRole: "article",
  },
  reminder: {
    field: "Reminder",
    timeRow: momentRows.reminder,
    view: "Reminders",
    projection: "reminders",
    addRow: "Add a reminder to the list",
    form: "New reminder",
    composerField: "Reminder",
    dialog: "Add reminder",
    rowRole: "article",
  },
} as const;

type Kind = keyof typeof planningEditors;

/** Sets the kind's moment on the composer: the task's day, the others' day and time. */
async function setComposerMoment(composer: Locator, kind: Kind) {
  if (kind === "task") {
    await composer.getByRole("button", { name: /^Due/ }).click();
    const typed = composer.getByLabel("Type a date", { exact: true });
    await typed.fill("2030-07-03");
    await typed.press("Escape");
    await expect(typed).toHaveCount(0);
    return;
  }
  await setMomentChip(
    composer,
    kind === "expense" ? /^Paid on/ : /^Remind at/,
    "2030-07-03",
    "11:30",
  );
}

/** Expects the kind's moment on the composer's chip. */
async function expectComposerMoment(composer: Locator, kind: Kind) {
  if (kind === "task") {
    await expect(
      composer.getByRole("button", { name: "Due: Jul 3, 2030", exact: true }),
    ).toBeVisible();
    return;
  }
  await expect(
    chip(composer, kind === "expense" ? /^Paid on: / : /^Remind at: /),
  ).toContainText("Jul 3, 2030");
}

/** Expects the kind's moment in the dialog More opened. */
async function expectDialogMoment(dialog: Locator, kind: Kind) {
  if (kind === "task") {
    await expectDue(dialog, "Jul 3, 2030");
    return;
  }
  await expectMoment(
    dialog,
    planningEditors[kind].timeRow,
    "Jul 3, 2030",
    "11:30 AM",
  );
}

/**
 * A task's composer keeps its own drafts: a composer left with text (an
 * add row's or a row's) is found open again with the text after leaving
 * the view and coming back, Escape discards it, and a reload clears it.
 * The dialog More opens keeps its drafts as before, offered as Resume /
 * Discard when More reaches it again.
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
  // More opens the dialog with the composer's fields and takes the draft
  // over; leaving the dialog with them keeps the dialog's draft, which
  // More offers to resume once the add row opens the composer again.
  await adding.getByRole("button", { name: /^More: / }).click();
  const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
  const dialogName = dialog.getByLabel("Task", { exact: true });
  await expect(dialogName).toHaveValue("Pack the lanterns");
  await expectDue(dialog, "Jul 3, 2030");
  await dialogName.fill("Pack the lanterns tonight");
  await revisitObjectView(page);
  await expect(adding).toHaveCount(0);
  await addRow.click();
  await expect(name).toHaveValue("");
  await adding.getByRole("button", { name: /^More: / }).click();
  const recovery = page.getByRole("dialog", {
    name: "Resume your draft?",
    exact: true,
  });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Resume draft", exact: true })
    .click();
  await expect(dialogName).toHaveValue("Pack the lanterns tonight");
  await expectDue(dialog, "Jul 3, 2030");
  await dialogName.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Pack the lanterns" });
  await expect(row).toHaveCount(1);
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

/**
 * A record's drafts live in its row's composer: a composer left with text
 * (an add row's, a row's, or the dialog More opens from it) is found open
 * again with the text after leaving the view and coming back; Escape
 * discards it, and a reload clears it.
 */
export async function exerciseObjectRecovery(
  page: Page,
  testInfo: TestInfo,
  kind: Kind,
) {
  // A task's composer keeps its drafts apart from its dialog's; the other
  // kinds share one draft between the composer and the dialog More opens.
  if (kind === "task") {
    await exerciseTaskComposerRecovery(page);
    return;
  }
  const editor = planningEditors[kind];
  await openEventView(page, "Overview");
  await openEventView(page, editor.view);
  const addRow = page.getByRole("button", { name: editor.addRow, exact: true });
  const adding = page.getByRole("form", { name: editor.form, exact: true });
  const name = adding.getByLabel(editor.composerField, { exact: true });
  await addRow.click();
  await name.fill("Pack the lanterns");
  if (kind === "expense") await setAmountChip(adding, "-0.0001", "CNY");
  await setComposerMoment(adding, kind);
  await revisitObjectView(page);
  // The composer comes back open with its text and its chips.
  await expect(name).toHaveValue("Pack the lanterns");
  await expectComposerMoment(adding, kind);
  if (kind === "expense")
    await expect(chip(adding, /^Amount: /)).toContainText("0.0001");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.locator("html")).toHaveCSS("color-scheme", colorScheme);
    await expectToken(adding, "background-color", "surface");
    await expectToken(name, "color", "ink");
    for (const set of await adding.locator(".chip.is-set").all())
      await expectToken(set, "color", "ink");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expectHorizontalReflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`${kind}-recovery-${colorScheme}.png`),
    });
  }
  // More opens the dialog with the composer's fields; leaving the dialog
  // with them keeps the same draft, found in the composer again.
  await adding.getByRole("button", { name: /^More: / }).click();
  const dialog = page.getByRole("dialog", { name: editor.dialog, exact: true });
  const dialogName = dialog.getByLabel(editor.field, { exact: true });
  await expect(dialogName).toHaveValue("Pack the lanterns");
  await expectDialogMoment(dialog, kind);
  if (kind === "expense") {
    await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
      "-0.0001",
    );
    await expect(dialog.getByLabel("Currency", { exact: true })).toHaveValue(
      "CNY",
    );
  }
  await dialogName.fill("Pack the lanterns tonight");
  await revisitObjectView(page);
  await expect(name).toHaveValue("Pack the lanterns tonight");
  await name.press("Enter");
  const row = page
    .getByRole(editor.rowRole)
    .filter({ hasText: "Pack the lanterns" });
  await expect(row).toHaveCount(1);
  await expect(name).toHaveValue("");
  await name.press("Escape");
  await expect(adding).toHaveCount(0);
  await expectHorizontalReflow(page);

  // A row's composer keeps its text the same way.
  await chooseRowAction(page, row, "Edit");
  const editing = page.getByRole("form", { name: /^Edit Pack the lanterns/ });
  const editingName = editing.getByLabel(editor.composerField, {
    exact: true,
  });
  await editingName.fill("Pack the lanterns and candles");
  await revisitObjectView(page);
  await expect(editingName).toHaveValue("Pack the lanterns and candles");
  await expect(editingName).toBeFocused();
  await editingName.press("Enter");
  await expect(editing).toHaveCount(0);
  await expect(
    page
      .getByRole(editor.rowRole)
      .filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);
  if (kind === "reminder") {
    // The row shows the rename only once the list has refetched; dismissing
    // before that would send the version the rename already replaced.
    await expect(row.getByRole("heading")).toHaveText(
      "Pack the lanterns and candles",
    );
    await chooseRowAction(page, row, "Dismiss");
    await expect(row.getByText("Dismissed", { exact: true })).toBeVisible();
    await chooseRowAction(page, row, "Edit");
    await editingName.fill("Pack the lanterns and candles tonight");
    await editingName.press("Enter");
    await expect(editing).toHaveCount(0);
    await expect(row.getByText("Dismissed", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await expect(
      page.getByRole("menu").getByRole("menuitem", { name: "Dismiss" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

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
    page
      .getByRole(editor.rowRole)
      .filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);
}

import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectDue, setDue } from "./due-picker";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";
import { chooseRowAction, rowMenuButton } from "./row-menu";

export async function exerciseTaskEditors(page: Page, testInfo: TestInfo) {
  const viewport = page.viewportSize();
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const panel = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  expect(before).not.toBeNull();
  await expect(page.getByLabel("Task", { exact: true })).toHaveCount(0);
  const add = page.getByRole("button", { name: "Add task", exact: true });
  await add.click();
  const create = page.getByRole("dialog", { name: "Add task", exact: true });
  const name = create.getByLabel("Task", { exact: true });
  await expect(name).toBeFocused();
  expect((await panel.boundingBox())?.height).toBe(before?.height);
  await name.fill("Pack garden supplies");
  await setDue(create, "2030-07-03", "11:30", 30);
  await expectDue(create, "Jul 3, 2030, 11:30 AM, 30 min");
  await name.press("Escape");
  const keep = page.getByRole("button", { name: "Keep editing", exact: true });
  await expect(keep).toBeFocused();
  await keep.click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Pack garden supplies");
  await page.screenshot({
    path: testInfo.outputPath("task-create-context.png"),
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(create, "background-color", "surface");
    await expectToken(create.getByRole("heading"), "color", "ink");
    await expectHorizontalReflow(page);
    await expect(
      create.getByRole("button", { name: "Create task", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`task-create-${colorScheme}.png`),
    });
  }
  await name.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(add).toBeFocused();
  let row = page.getByRole("row").filter({ hasText: "Pack garden supplies" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("30 min");
  if (viewport) await page.setViewportSize(viewport);
  await chooseRowAction(page, row, "Edit");
  const edit = page.getByRole("dialog", { name: "Edit task", exact: true });
  const editorName = edit.getByLabel("Task", { exact: true });
  await expect(editorName).toBeFocused();
  await expectDue(edit, "Jul 3, 2030, 11:30 AM, 30 min");
  await editorName.fill("Pack garden supplies and chairs");
  await page.screenshot({ path: testInfo.outputPath("task-edit-context.png") });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(edit, "background-color", "surface");
    await expectToken(edit.getByRole("heading"), "color", "ink");
    await expectHorizontalReflow(page);
    await expect(
      edit.getByRole("button", { name: "Save task", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`task-edit-${colorScheme}.png`),
    });
  }
  await editorName.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  row = page
    .getByRole("row")
    .filter({ hasText: "Pack garden supplies and chairs" });
  await expect(row).toHaveCount(1);
  await expect(rowMenuButton(row)).toBeFocused();
  await row
    .getByRole("button", {
      name: "Complete Pack garden supplies and chairs",
      exact: true,
    })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "Done", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", {
      name: "Reopen Pack garden supplies and chairs",
      exact: true,
    })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "Open", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(row).toHaveCount(1);
}

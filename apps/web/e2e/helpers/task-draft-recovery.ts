import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectToken } from "./appearance";
import { expectHorizontalReflow } from "./page-navigation";

export async function revisitTaskView(page: Page) {
  const url = page.url();
  const length = await page.evaluate(() => history.length);
  await page.goBack();
  await expect(page).not.toHaveURL(url);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => history.length)).toBe(length);
}

export async function exerciseTaskRecovery(page: Page, testInfo: TestInfo) {
  await page.getByRole("button", { name: "Browse event data" }).click();
  await page.getByRole("tab", { name: "To-dos", exact: true }).click();
  const add = page.getByRole("button", { name: "Add task", exact: true });
  const name = page.getByLabel("Task", { exact: true });
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
  await page.getByLabel("Due", { exact: true }).fill("2030-07-03T11:30");
  await revisitTaskView(page);
  await add.click();
  await expect(recovery).toBeVisible();
  await expect(name).toHaveCount(0);
  await expect(resume).toBeFocused();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectToken(recovery, "background-color", "surface");
    await expectToken(recovery, "color", "ink");
    await expectHorizontalReflow(page);
    await expect(resume).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`task-recovery-${colorScheme}.png`),
    });
  }
  await resume.click();
  await expect(name).toHaveValue("Pack the lanterns");
  await expect(name).toBeFocused();
  await expect(page.getByLabel("Due", { exact: true })).toHaveValue(
    "2030-07-03T11:30",
  );
  await name.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Pack the lanterns" });
  await expect(row).toHaveCount(1);
  const edit = row.getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  await name.fill("Pack the lanterns and candles");
  await revisitTaskView(page);
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
  await add.click();
  await name.fill("Discard this plan");
  await revisitTaskView(page);
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
    page.getByRole("row").filter({ hasText: "Pack the lanterns and candles" }),
  ).toHaveCount(1);
}

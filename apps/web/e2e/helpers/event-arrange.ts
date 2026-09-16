import { expect, type Page, type TestInfo } from "@playwright/test";
import { openCommands } from "./context-commands";
import { expectHorizontalReflow } from "./page-navigation";

export async function exerciseEventArrange(page: Page, testInfo: TestInfo) {
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const addPage = page.getByRole("dialog", { name: "Add a page" });
  await addPage.getByLabel("Page name").fill("Preparation");
  await addPage.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(addPage).toHaveCount(0);
  for (const label of ["To-dos", "Calendar"]) {
    await page
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    const picker = page.getByRole("dialog", { name: "Add a component" });
    await picker.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
    await picker
      .getByRole("button", { name: `Add ${label}`, exact: true })
      .click();
    await expect(picker).toHaveCount(0);
  }
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitemradio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  // The filter is session state of the To-dos component: arranging must
  // keep the component mounted, so the choice survives every toggle.
  const filter = page.getByRole("button", {
    name: "Filter: 1 filter",
    exact: true,
  });
  const controls = page.getByRole("group", { name: /layout controls/ });
  const canvas = page.getByRole("region", { name: "Event pages", exact: true });
  await expect(controls).toHaveCount(0);

  const commands = await openCommands(page);
  await commands
    .getByRole("combobox", { name: "Find a command" })
    .fill("Arrange layout");
  await page.keyboard.press("Enter");
  const done = page.getByRole("button", {
    name: "Done arranging",
    exact: true,
  });
  await expect(done).toBeFocused();
  await expect(controls).toHaveCount(2);
  await expect(filter).toHaveClass(/is-active/);
  await page.keyboard.press("Enter");
  const arrange = page.getByRole("button", {
    name: "Arrange layout",
    exact: true,
  });
  await expect(arrange).toBeFocused();
  await expect(controls).toHaveCount(0);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 568 });
    await arrange.scrollIntoViewIfNeeded();
    await expectHorizontalReflow(page);
    const addPageTop = await page
      .getByRole("button", { name: "Add page", exact: true })
      .evaluate((button) =>
        Math.round(button.getBoundingClientRect().top + window.scrollY),
      );
    await canvas.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`event-quiet-${colorScheme}.png`),
    });
    await arrange.click();
    await expectHorizontalReflow(page);
    await expect(page.getByText(/Moves save immediately/)).toBeVisible();
    await expect(controls.first()).toBeVisible();
    expect(
      await page
        .getByRole("button", { name: "Add page", exact: true })
        .evaluate((button) =>
          Math.round(button.getBoundingClientRect().top + window.scrollY),
        ),
    ).toBe(addPageTop);
    await canvas.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`event-arrange-${colorScheme}.png`),
    });
    await done.click();
    await expect(filter).toHaveClass(/is-active/);
  }

  await arrange.click();
  await openCommands(page);
  await commands.getByRole("option", { name: /Done arranging/ }).click();
  await expect(arrange).toBeFocused();
  await expect(controls).toHaveCount(0);
  await expect(filter).toHaveClass(/is-active/);
  await arrange.click();
  await page.reload();
  await expect(arrange).toBeVisible();
  await expect(controls).toHaveCount(0);

  await page.getByRole("button", { name: "Page options", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "Manage event pages" });
  await expect(
    recovery.getByRole("button", { name: "Layout history", exact: true }),
  ).toBeVisible();
  await recovery
    .getByRole("button", { name: "Remove To-dos from Preparation" })
    .click();
  await recovery.getByRole("button", { name: "Remove from layout" }).click();
  await expect(recovery.getByRole("status")).toHaveText(
    "Layout saved. Planning records are unchanged.",
  );
  await recovery.getByRole("button", { name: "Undo layout change" }).click();
  await expect(
    recovery.getByRole("button", { name: "Remove To-dos from Preparation" }),
  ).toBeVisible();
  await recovery.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "To-dos", exact: true }),
  ).toBeVisible();
  await expect(controls).toHaveCount(0);
}

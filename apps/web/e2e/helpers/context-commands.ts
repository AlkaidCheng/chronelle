import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";
import { pressSearchEntry } from "./quiet-chrome";

export async function openCommands(page: Page) {
  await pressSearchEntry(page);
  return page.getByRole("dialog", { name: "Search", exact: true });
}

export async function exerciseContextCommands(
  page: Page,
  testInfo: TestInfo,
  { canShare }: { readonly canShare: boolean },
) {
  const dialog = await openCommands(page);
  const results = dialog.getByRole("listbox", { name: "Commands" });
  const input = dialog.getByRole("combobox", {
    name: "Search records and commands",
  });
  await input.fill("Edit event");
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  await name.fill("Unsaved gathering name");
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(name).toHaveValue("Unsaved gathering name");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit event", exact: true }),
  ).toBeFocused();

  await openCommands(page);
  await dialog.getByRole("option", { name: /Event history/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(
    page.getByRole("button", { name: /^History for / }),
  ).toBeFocused();

  await openCommands(page);
  if (canShare) {
    await dialog.getByRole("option", { name: /Share event/ }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Sharing", exact: true }),
    ).toBeFocused();
    await expect(page.getByLabel("Collaborator email")).toBeVisible();
    await openCommands(page);
    await expect(
      dialog.getByRole("option", {
        name: /Share event|Add component/,
      }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  } else {
    await expect(
      dialog.getByRole("option", { name: /Share event/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  await openCommands(page);
  await dialog.getByRole("option", { name: /Add page/ }).click();
  const pageDialog = page.getByRole("dialog", {
    name: "Add a page",
    exact: true,
  });
  await expect(pageDialog.getByLabel("Page name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Add page", exact: true }),
  ).toBeFocused();
  await openCommands(page);
  await dialog.getByRole("option", { name: /Add page/ }).click();
  const pageName = "Preparations, reservations, and quiet afternoons together";
  await pageDialog.getByLabel("Page name").fill(pageName);
  await pageDialog
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  await expect(pageDialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: pageName, exact: true }),
  ).toBeVisible();

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 568 });
    await openCommands(page);
    await expect(
      dialog.getByRole("group", { name: "Event actions" }).getByRole("option"),
    ).toHaveCount(canShare ? 6 : 5);
    await expectHorizontalReflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`context-commands-${colorScheme}-narrow.png`),
    });
    await input.press("ArrowUp");
    await expect(dialog.getByRole("option", { name: /Trash/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect
      .poll(() =>
        results.getByRole("option", { selected: true }).evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const container = element
            .closest(".command-results")
            ?.getBoundingClientRect();
          return (
            container !== undefined &&
            bounds.top >= container.top - 1 &&
            bounds.bottom <= container.bottom + 1
          );
        }),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
  }
  await openCommands(page);
  await input.fill("Add component");
  await expect(results.getByRole("option")).toContainText(pageName);
  await input.press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Add a component",
    exact: true,
  });
  await expect(
    picker.getByRole("searchbox", { name: "Find a component" }),
  ).toBeFocused();
  await expect(picker).toContainText(`Add to ${pageName}.`);
  await picker.getByRole("button", { name: "Add To-dos", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "To-dos component 1", exact: true }),
  ).toBeVisible();
  await openCommands(page);
  await input.fill("Search");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Search", exact: true }),
  ).toBeVisible();
  await openCommands(page);
  await expect(
    dialog.getByRole("group", { name: "Event actions" }),
  ).toHaveCount(0);
  await expect(results.getByRole("option")).toHaveCount(5);
  await page.keyboard.press("Escape");
}

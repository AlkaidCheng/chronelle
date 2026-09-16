import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectDates, setDates } from "./range-picker";

export async function exerciseEventDrafts(page: Page, testInfo: TestInfo) {
  const trigger = page.getByRole("button", { name: "New event", exact: true });
  const editor = page.getByRole("dialog", {
    name: "Create an event",
    exact: true,
  });
  const confirmation = page.getByRole("dialog", {
    name: "Discard this event?",
    exact: true,
  });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  const name = editor.getByLabel("Event name", { exact: true });
  await name.fill("Summer gathering");
  await editor.getByRole("switch", { name: "Set dates" }).check();
  await setDates(editor, "2030-07-03", "2030-07-12");
  await name.focus();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  const keep = confirmation.getByRole("button", {
    name: "Keep editing",
    exact: true,
  });
  await expect(keep).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    confirmation.getByRole("button", { name: "Discard", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keep).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Summer gathering");
  await expect(editor.getByRole("table", { name: "July 2030" })).toBeVisible();
  await expectDates(editor, "Jul 3, 2030 to Jul 12, 2030");
  await editor.getByRole("button", { name: "Close event creation" }).click();
  await page.keyboard.press("Escape");
  await expect(
    editor.getByRole("button", { name: "Close event creation" }),
  ).toBeFocused();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(keep).toBeInViewport();
    await expect(
      confirmation.getByRole("button", { name: "Discard", exact: true }),
    ).toBeInViewport();
    expect(
      await confirmation.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`discard-${colorScheme}.png`),
    });
  }
  if (viewport) await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "light" });
  await keep.click();
  await expect(name).toHaveValue("Summer gathering");
  await editor
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Summer gathering", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-date")).toHaveText(
    "Jul 3, 2030 to Jul 12, 2030",
  );
  await page.getByRole("link", { name: "Events", exact: true }).first().click();
  await trigger.click();
  await name.fill("Discarded idea");
  await page.keyboard.press("Escape");
  await confirmation
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(name).toHaveValue("");
  await expect(
    editor.getByRole("switch", { name: "Set dates" }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
}

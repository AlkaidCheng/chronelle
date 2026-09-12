import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectHorizontalReflow } from "./page-navigation";

export async function createRecoveryEvent(page: Page) {
  await expect(
    page.getByRole("button", { name: "New event", exact: true }),
  ).toBeVisible();
  const collectionUrl = page.url();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Garden evening");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit event", exact: true }),
  ).toBeVisible();
  return { collectionUrl, eventUrl: page.url() };
}

export async function exerciseEventDraftRecovery(
  page: Page,
  testInfo: TestInfo,
) {
  const { collectionUrl, eventUrl } = await createRecoveryEvent(page);
  const edit = page.getByRole("button", { name: "Edit event", exact: true });
  const create = page.getByRole("button", { name: "New event", exact: true });
  const historyLength = await page.evaluate(() => window.history.length);
  await edit.click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Recovered garden evening");
  await page.getByRole("switch", { name: "Set dates", exact: true }).check();
  await page.getByRole("button", { name: "Change year", exact: true }).click();
  await page.getByRole("textbox", { name: "Go to year" }).fill("2030");
  await page.getByRole("textbox", { name: "Go to year" }).press("Enter");
  await page.getByRole("button", { name: "Change month", exact: true }).click();
  await page.getByRole("button", { name: "July", exact: true }).click();
  await page.getByRole("button", { name: "Jul 3, 2030", exact: true }).click();
  await page.getByRole("button", { name: "Jul 12, 2030", exact: true }).click();

  for (let index = 0; index < 2; index++) {
    await page.goBack();
    await expect(page).toHaveURL(collectionUrl);
    await expect(create).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(eventUrl);
    await expect(edit).toBeVisible();
  }
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
  await edit.click();
  const recovery = page.getByRole("dialog", {
    name: "Resume your draft?",
    exact: true,
  });
  await expect(recovery).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(
    recovery.getByRole("button", { name: "Resume draft", exact: true }),
  ).toBeFocused();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectHorizontalReflow(page);
    await expect(
      recovery.getByRole("button", { name: "Resume draft", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`recovery-${colorScheme}.png`),
    });
  }
  await recovery
    .getByRole("button", { name: "Resume draft", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered garden evening",
  );
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "End date: Jul 12, 2030", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Recovered garden evening",
      exact: true,
    }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(collectionUrl);
  await create.click();
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Private creation draft");
  await page.goForward();
  await expect(page).toHaveURL(eventUrl);
  await page.goBack();
  await expect(page).toHaveURL(collectionUrl);
  await create.click();
  await recovery
    .getByRole("button", { name: "Resume draft", exact: true })
    .click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue(
    "Private creation draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Event name", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await create.click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("");
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Reload clears this draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await create.click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
}

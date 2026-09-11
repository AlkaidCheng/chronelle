import { expect, test } from "@playwright/test";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("creates a date-only range in a focused dialog without moving the collection", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  const collection = page.locator(".event-list-section");
  const before = await collection.boundingBox();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create an event",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Event name", { exact: true })).toBeFocused();
  expect(await collection.boundingBox()).toEqual(before);
  await dialog
    .getByLabel("Event name", { exact: true })
    .fill("Summer vacation");
  await page.screenshot({ path: testInfo.outputPath("create-event.png") });
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog.getByRole("button", { name: "Change year" }).click();
  await dialog.getByRole("button", { name: "2030", exact: true }).click();
  await dialog.getByRole("button", { name: "Change month" }).click();
  await dialog.getByRole("button", { name: "July", exact: true }).click();
  await expect(dialog.getByRole("grid", { name: "July 2030" })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Jul 3, 2030", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Jul 12, 2030", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "End date: Jul 12, 2030" }),
  ).toBeVisible();
  await expect(dialog.locator('[data-in-range="true"]')).toHaveCount(10);
  await expect(dialog.getByRole("grid", { name: "July 2030" })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: testInfo.outputPath("date-range.png") });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog.getByRole("grid")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("event-ready.png") });
  await expect(
    dialog.getByRole("button", { name: "Create event", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Summer vacation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-date")).toHaveText(
    /Jul 3, 2030 to Jul 12, 2030/,
  );
  await expect(page.getByLabel("Object ID", { exact: true })).toBeHidden();
  await page
    .locator(".event-hero")
    .getByText("Details", { exact: true })
    .click();
  await expect(page.getByLabel("Object ID", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".event-date")).toHaveText(
    /Jul 3, 2030 to Jul 12, 2030/,
  );
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Set dates" })).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Add times" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Start date: Jul 3, 2030" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "End date: Jul 12, 2030" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    localStorage.getItem("chronelle.design-sandbox.v1"),
  );
  const alternate = await browser.newContext({
    timezoneId: "Asia/Tokyo",
    locale: "en-US",
    offline: true,
  });
  try {
    const preview = await alternate.newPage();
    await preview.goto(sandboxUrl);
    await preview.evaluate((value) => {
      if (value !== null)
        localStorage.setItem("chronelle.design-sandbox.v1", value);
    }, saved);
    await preview.goto(page.url());
    await preview.reload();
    await expect(preview.locator(".event-date")).toHaveText(
      /Jul 3, 2030 to Jul 12, 2030/,
    );
    await preview
      .getByRole("button", { name: "Edit event", exact: true })
      .click();
    await expect(
      preview.getByRole("button", { name: "Start date: Jul 3, 2030" }),
    ).toBeVisible();
  } finally {
    await alternate.close();
  }
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("calendar supports leap-day keyboard navigation, range reset, and optional times", async ({
  page,
}, testInfo) => {
  await page.goto(sandboxUrl);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog.getByRole("button", { name: "Change year" }).click();
  await dialog.getByRole("button", { name: "2028", exact: true }).click();
  await dialog.getByRole("button", { name: "Change month" }).click();
  await dialog.getByRole("button", { name: "February", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Feb 28, 2028", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("button", { name: "Feb 29, 2028", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Start date: Feb 29, 2028" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("grid", { name: "March 2028" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "End date: Mar 1, 2028" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Mar 8, 2028", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Start date: Mar 8, 2028" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "End date: Optional" }),
  ).toBeVisible();
  await dialog.getByRole("switch", { name: "Add times" }).check();
  await dialog.getByLabel("Start time", { exact: true }).fill("09:30");
  await dialog.getByLabel("End time (optional)", { exact: true }).fill("17:00");
  await expect(
    dialog.getByRole("button", { name: "End date: Mar 8, 2028" }),
  ).toBeVisible();
  await dialog.getByLabel("End time (optional)", { exact: true }).fill("");
  await expect(
    dialog.getByRole("button", { name: "End date: Optional" }),
  ).toBeVisible();
  await dialog.getByLabel("End time (optional)", { exact: true }).fill("17:00");
  await expect(
    dialog.getByRole("button", { name: "Create event", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("optional-times.png") });
  await dialog.getByRole("switch", { name: "Add times" }).uncheck();
  await expect(dialog.getByLabel("Start time", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Clear dates" }).click();
  await expect(
    dialog.getByRole("button", { name: "Start date: Choose a day" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New event", exact: true }),
  ).toBeFocused();
});

test("creation makes the background inert and allows a single day or no dates", async ({
  page,
}) => {
  await page.goto(sandboxUrl);
  const trigger = page.getByRole("button", { name: "New event", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Create an event" });
  await trigger.evaluate((element) => element.focus());
  await expect(trigger).not.toBeFocused();
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await dialog.getByLabel("Event name", { exact: true }).fill("One day");
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("date");
  await dialog.getByRole("button", { name: "Change year" }).click();
  await dialog.getByRole("button", { name: "2028", exact: true }).click();
  await dialog.getByRole("button", { name: "Change month" }).click();
  await dialog.getByRole("button", { name: "April", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Apr 4, 2028", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(page.locator(".event-date")).toHaveText("Apr 4, 2028");
  await page.getByRole("link", { name: "Events", exact: true }).first().click();
  await trigger.click();
  await dialog.getByLabel("Event name", { exact: true }).fill("Unscheduled");
  await dialog.getByRole("switch", { name: "Set dates" }).check();
  await dialog.getByRole("switch", { name: "Set dates" }).uncheck();
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(page.locator(".event-date")).toContainText(
    "Schedule to be decided",
  );
});

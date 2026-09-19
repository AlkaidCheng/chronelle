import { expect, test } from "@playwright/test";
import {
  closeDatePanel,
  datesRow,
  dayName,
  expectDates,
  expectNoDates,
  expectTimes,
  openDatePanel,
  setDates,
  timesRow,
} from "../../e2e/helpers/date-rows";

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
  await openDatePanel(dialog, datesRow(dialog));
  await dialog
    .getByRole("button", { name: /^Choose a month and year/ })
    .click();
  await dialog.getByLabel("Month and year", { exact: true }).fill("July 2030");
  await dialog.getByLabel("Month and year", { exact: true }).press("Enter");
  await expect(dialog.getByRole("table", { name: "July 2030" })).toBeVisible();
  await dialog.getByRole("button", { name: dayName("2030-07-03") }).click();
  await dialog.getByRole("button", { name: dayName("2030-07-12") }).click();
  await expectDates(dialog, "Jul 3, 2030 to Jul 12, 2030");
  await expect(dialog.locator("td.is-between")).toHaveCount(8);
  await expect(
    dialog.getByRole("table", { name: "July 2030" }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("date-range.png") });
  await closeDatePanel(dialog);
  await expect(dialog.getByRole("table")).toHaveCount(0);
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
  await page.reload();
  await expect(page.locator(".event-date")).toHaveText(
    /Jul 3, 2030 to Jul 12, 2030/,
  );
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit event", exact: true });
  await expectDates(edit, "Jul 3, 2030 to Jul 12, 2030");
  await expect(timesRow(edit)).toHaveText(/^Set times/);
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
    await expectDates(
      preview.getByRole("dialog", { name: "Edit event", exact: true }),
      "Jul 3, 2030 to Jul 12, 2030",
    );
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
  await openDatePanel(dialog, datesRow(dialog));
  await dialog
    .getByRole("button", { name: /^Choose a month and year/ })
    .click();
  await dialog
    .getByLabel("Month and year", { exact: true })
    .fill("February 2028");
  await dialog.getByLabel("Month and year", { exact: true }).press("Enter");
  await dialog.getByRole("button", { name: dayName("2028-02-28") }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("button", { name: dayName("2028-02-29") }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expectDates(dialog, "Feb 29, 2028");
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("button", { name: dayName("2028-03-01") }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expectDates(dialog, "Feb 29, 2028 to Mar 1, 2028");
  await dialog.getByRole("button", { name: dayName("2028-03-08") }).click();
  await expectDates(dialog, "Mar 8, 2028");
  const typed = dialog.getByLabel("Type a date", { exact: true });
  await expect(typed).toHaveValue("Mar 8, 2028");
  // Times unfold in the same panel; an end time keeps the one-day span.
  await dialog.getByRole("button", { name: "Times", exact: true }).click();
  await dialog.getByLabel("Start", { exact: true }).fill("09:30");
  await dialog.getByLabel("End", { exact: true }).fill("17:00");
  await expect(typed).toHaveValue("Mar 8, 2028");
  await expect(
    dialog.getByRole("button", { name: "Create event", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("optional-times.png") });
  await closeDatePanel(dialog);
  await expectTimes(dialog, "9:30 AM to 5:00 PM");
  await dialog
    .getByRole("button", { name: "Clear times", exact: true })
    .click();
  await expect(timesRow(dialog)).toHaveText(/^Set times/);
  await expectDates(dialog, "Mar 8, 2028");
  await dialog
    .getByRole("button", { name: "Clear dates", exact: true })
    .click();
  await expectNoDates(dialog);
  await page.keyboard.press("Escape");
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
  await setDates(dialog, "Apr 4, 2028");
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(page.locator(".event-date")).toHaveText("Apr 4, 2028");
  await page.getByRole("link", { name: "Events", exact: true }).first().click();
  await trigger.click();
  await dialog.getByLabel("Event name", { exact: true }).fill("Unscheduled");
  await setDates(dialog, "Apr 4, 2028");
  await dialog
    .getByRole("button", { name: "Clear dates", exact: true })
    .click();
  await expectNoDates(dialog);
  await dialog
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(page.locator(".event-date")).toHaveCount(0);
});

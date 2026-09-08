import { expect, test } from "@playwright/test";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("creates a multi-day date-only event with independent month/year controls", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Summer vacation");
  await page.getByLabel("Date precision").selectOption("dates");
  await page
    .getByRole("button", { name: "Choose start date", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Start date", exact: true });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Year", { exact: true }).fill("2030");
  await picker
    .getByRole("combobox", { name: "Month", exact: true })
    .selectOption("7");
  await expect(picker.getByLabel("Year", { exact: true })).toHaveValue("2030");
  await page.screenshot({ path: testInfo.outputPath("date-picker.png") });
  await picker.getByRole("button", { name: "2030-07-03", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Choose start date", exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("End date (optional)", { exact: true })
    .fill("2030-07-12");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
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
  await expect(page.getByLabel("Date precision")).toHaveValue("dates");
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue(
    "2030-07-03",
  );
  await expect(
    page.getByLabel("End date (optional)", { exact: true }),
  ).toHaveValue("2030-07-12");
  await page.screenshot({
    path: testInfo.outputPath("event-schedule.png"),
    fullPage: true,
  });
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
    await expect(preview.getByLabel("Start date", { exact: true })).toHaveValue(
      "2030-07-03",
    );
  } finally {
    await alternate.close();
  }
});

test("date picker supports keyboard navigation and invalid-date correction", async ({
  page,
}) => {
  await page.goto(sandboxUrl);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Date precision").selectOption("dates");
  await page.getByLabel("Start date", { exact: true }).fill("2028-02-30");
  await page
    .getByRole("button", { name: "Choose start date", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Start date", exact: true });
  await picker.getByLabel("Year", { exact: true }).fill("2028");
  await picker
    .getByRole("combobox", { name: "Month", exact: true })
    .selectOption("2");
  await picker.getByRole("button", { name: "2028-02-28", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    picker.getByRole("button", { name: "2028-02-29", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue(
    "2028-02-29",
  );
  expect(
    await page
      .getByLabel("Start date", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.valid),
  ).toBe(true);
});

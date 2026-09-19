import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, type Page, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";
import {
  chip,
  composer,
  openAddComposer,
  pressRow,
  setAmountChip,
  setMomentChip,
  setPlaceChip,
  setSpanChip,
  submitComposer,
} from "./helpers/record-composers";
import { chooseRowAction } from "./helpers/row-menu";

// The chips read times in the shown zone; pinned, so they read the same on
// every machine.
test.use({ timezoneId: "Asia/Tokyo" });

async function signInWithEvent(
  page: Page,
  request: APIRequestContext,
  slug: string,
) {
  const email = `${slug}-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const headers = {
    authorization: `Bearer ${(await signedIn.json()).accessToken}`,
  };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Kyoto in November", timezone: "Asia/Tokyo" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  return { event, headers };
}

test("adds a schedule item, a reminder, and an expense from their add rows' composers @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const { event, headers } = await signInWithEvent(page, request, "records");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mobile = testInfo.project.name.endsWith("mobile");

  // Calendar: the composer takes a name, a span with times on the Dates
  // chip, and a place; Enter adds and keeps it open; Escape closes it.
  await openEventView(page, "Calendar");
  const calendar = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Calendar", exact: true }),
  });
  const schedule = await openAddComposer(
    calendar,
    "Add schedule item",
    "New schedule item",
    "Lunch at the market",
  );
  await expect(
    schedule.getByRole("button", { name: "Add to schedule", exact: true }),
  ).toBeEnabled();
  await expect(
    schedule.getByLabel("Description", { exact: true }),
  ).toBeVisible();
  await setSpanChip(schedule, "2030-11-03", { start: "12:00", end: "13:00" });
  await expect(chip(schedule, /^Dates: /)).toContainText("Nov 3, 2030");
  await expect(chip(schedule, /^Dates: /)).toContainText("12:00");
  await chip(schedule, /^Place$/).click();
  const place = page.getByRole("dialog", { name: "Place", exact: true });
  await expect(place).toBeVisible();
  if (mobile) {
    // On a phone the chip's control is a sheet from the bottom.
    const box = await place.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(Math.round(box.x)).toBe(0);
      expect(Math.round(box.width)).toBe(viewport.width);
      expect(Math.round(box.y + box.height)).toBe(viewport.height);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("schedule-composer.png") });
  await place.getByRole("textbox", { name: "Place" }).fill("Nishiki");
  await place.getByRole("textbox", { name: "Place" }).press("Enter");
  await expect(place).toHaveCount(0);
  await expect(chip(schedule, /^Place: Nishiki$/)).toBeFocused();
  const scheduleCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}/resources`) &&
      response.request().method() === "POST",
  );
  await submitComposer(schedule);
  expect((await scheduleCreated).status()).toBe(201);
  const lunch = calendar
    .getByRole("article")
    .filter({ hasText: "Lunch at the market" });
  await expect(lunch).toBeVisible();
  await expect(lunch).toContainText("Nishiki");
  await expect(
    schedule.getByLabel("Schedule item", { exact: true }),
  ).toHaveValue("");
  await expect(chip(schedule, /^Dates$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(schedule).toHaveCount(0);
  await expect(
    calendar.getByRole("button", { name: "Add schedule item", exact: true }),
  ).toBeFocused();

  // Reminders: the composer starts with the next nine o'clock; the chip
  // takes another day and time.
  await openEventView(page, "Reminders");
  const reminders = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Reminders", exact: true }),
  });
  const reminder = await openAddComposer(
    reminders,
    "Add a reminder to the list",
    "New reminder",
    "Call the ryokan",
  );
  await expect(reminder.getByLabel("Description", { exact: true })).toHaveCount(
    0,
  );
  await expect(chip(reminder, /^Remind at: /)).toContainText("9:00");
  await setMomentChip(reminder, /^Remind at/, "2030-11-02", "18:30");
  await expect(chip(reminder, /^Remind at: /)).toContainText("Nov 2, 2030");
  await submitComposer(reminder);
  const call = reminders
    .getByRole("article")
    .filter({ hasText: "Call the ryokan" });
  await expect(call).toBeVisible();
  await expect(call).toContainText("6:30 PM");
  await expect(reminder.getByLabel("Reminder", { exact: true })).toHaveValue(
    "",
  );
  await page.keyboard.press("Escape");
  await expect(reminder).toHaveCount(0);

  // Expenses: the composer refuses a name without an amount, opening the
  // Amount chip; with one and a day paid, Enter adds.
  await openEventView(page, "Expenses");
  const expenses = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Expenses", exact: true }),
  });
  const expense = await openAddComposer(
    expenses,
    "Add expense",
    "New expense",
    "Market lunch",
  );
  await submitComposer(expense);
  await expect(expense.getByRole("alert")).toHaveText(
    "Enter an amount and a three-letter currency.",
  );
  await expect(
    expense.getByRole("textbox", { name: "Amount", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await setAmountChip(expense, "3200", "JPY");
  await expect(chip(expense, /^Amount: /)).toContainText("3,200");
  await setMomentChip(expense, /^Paid on/, "2030-11-03", "13:10");
  await submitComposer(expense);
  const paid = expenses
    .getByRole("article")
    .filter({ hasText: "Market lunch" });
  await expect(paid).toBeVisible();
  await expect(paid).toContainText("3,200");
  await expect(
    expense.getByLabel("What was paid for", { exact: true }),
  ).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(expense).toHaveCount(0);

  const timeline = await request.get(`/api/events/${event.id}/timeline`, {
    headers,
  });
  expect(
    (await timeline.json()).items.map(
      (item: { objectType: string; displayName: string }) => [
        item.objectType,
        item.displayName,
      ],
    ),
  ).toEqual(
    expect.arrayContaining([
      ["event", "Lunch at the market"],
      ["reminder", "Call the ryokan"],
      ["expense", "Market lunch"],
    ]),
  );
  expect(errors).toEqual([]);
});

test("edits a schedule row, an expense row, and a Timeline entry in place, and refuses a stale save @webkit-desktop", async ({
  page,
  request,
}) => {
  const { event, headers } = await signInWithEvent(page, request, "rows");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const resources = `/api/events/${event.id}/resources`;
  const item = (
    await (
      await request.post(resources, {
        headers,
        data: {
          commandId: randomUUID(),
          resource: {
            objectType: "event",
            displayName: "Fushimi Inari",
            startsAt: "2030-11-03T00:30:00.000Z",
            endsAt: "2030-11-03T02:30:00.000Z",
          },
        },
      })
    ).json()
  ).resource;
  const deposit = (
    await (
      await request.post(resources, {
        headers,
        data: {
          commandId: randomUUID(),
          resource: {
            objectType: "expense",
            displayName: "Ryokan deposit",
            amount: "48000",
            currency: "JPY",
            occurredAt: "2030-09-10T03:00:00.000Z",
          },
        },
      })
    ).json()
  ).resource;

  // A Calendar row opens in place; Save writes one versioned update, and
  // the row takes focus back.
  await openEventView(page, "Calendar");
  const calendar = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Calendar", exact: true }),
  });
  await pressRow(calendar, "Fushimi Inari");
  // The composer is named for the row, which the first save renames.
  const schedule = page.getByRole("form", { name: /^Edit Fushimi Inari/ });
  const name = schedule.getByLabel("Schedule item", { exact: true });
  await expect(name).toBeFocused();
  await expect(chip(schedule, /^Dates: /)).toContainText("Nov 3, 2030");
  await setPlaceChip(schedule, "Main gate");
  await name.fill("Fushimi Inari, the lower loop");
  await schedule.getByRole("button", { name: "Save", exact: true }).click();
  await expect(schedule).toHaveCount(0);
  const loop = calendar
    .getByRole("article")
    .filter({ hasText: "Fushimi Inari, the lower loop" });
  await expect(loop).toBeVisible();
  await expect(loop).toContainText("Main gate");
  await expect(
    loop.getByRole("button", { name: "Edit Fushimi Inari, the lower loop" }),
  ).toBeFocused();
  expect(
    await (await request.get(`/api/events/${item.id}`, { headers })).json(),
  ).toMatchObject({ version: 2, location: "Main gate" });

  // Cancel leaves the row alone; the row menu's Edit opens it too; a save
  // refused as stale shows the comparison, and Take theirs loads it.
  await pressRow(calendar, "Fushimi Inari, the lower loop");
  await name.fill("Nothing");
  await schedule.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(schedule).toHaveCount(0);
  await expect(loop).toContainText("Fushimi Inari, the lower loop");
  await chooseRowAction(page, loop, "Edit");
  await expect(name).toBeFocused();
  await name.fill("Fushimi Inari at dawn");
  const elsewhere = await request.patch(`/api/events/${item.id}`, {
    headers,
    data: { expectedVersion: 2, location: "Inari station" },
  });
  expect(elsewhere.status()).toBe(200);
  await schedule.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    schedule.getByText("Saved elsewhere while you edited"),
  ).toBeVisible();
  await schedule
    .getByRole("button", { name: "Take theirs", exact: true })
    .click();
  await expect(name).toHaveValue("Fushimi Inari, the lower loop");
  await expect(chip(schedule, /^Place: Inari station$/)).toBeVisible();
  await name.press("Escape");
  await expect(schedule).toHaveCount(0);

  // An Expenses row edits its amount through the chip's panel.
  await openEventView(page, "Expenses");
  const expenses = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Expenses", exact: true }),
  });
  await pressRow(expenses, "Ryokan deposit");
  const expense = composer(page, "Edit Ryokan deposit");
  await expect(chip(expense, /^Amount: /)).toContainText("48,000");
  await setAmountChip(expense, "52000");
  await expense.getByRole("button", { name: "Save", exact: true }).click();
  await expect(expense).toHaveCount(0);
  await expect(
    expenses.getByRole("article").filter({ hasText: "Ryokan deposit" }),
  ).toContainText("52,000");
  expect(
    await (
      await request.get(`/api/expenses/${deposit.id}`, { headers })
    ).json(),
  ).toMatchObject({ version: 2, amount: "52000.0000" });

  // A Timeline entry opens its record's composer in place.
  await openEventView(page, "Timeline");
  await pressRow(page, "Ryokan deposit");
  const entry = composer(page, "Edit Ryokan deposit");
  await expect(
    entry.getByLabel("What was paid for", { exact: true }),
  ).toHaveValue("Ryokan deposit");
  await entry
    .getByLabel("What was paid for", { exact: true })
    .fill("Ryokan deposit, paid");
  await entry.getByRole("button", { name: "Save", exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Ryokan deposit, paid", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

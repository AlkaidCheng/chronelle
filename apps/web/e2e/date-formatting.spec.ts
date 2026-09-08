import { randomUUID } from "node:crypto";
import { eventResponseSchema } from "@chronelle/schemas";
import { expect, test } from "@playwright/test";

test("creates a date-only range and switches to multi-day exact times", async ({
  page,
  request,
}) => {
  const email = `schedule-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Summer vacation");
  await page.getByLabel("Date precision").selectOption("dates");
  await page.getByLabel("Start date", { exact: true }).fill("2030-07-03");
  await page
    .getByLabel("End date (optional)", { exact: true })
    .fill("2030-07-12");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Summer vacation", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}(?:\?.*)?$/);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const read = async () => {
    const response = await request.get(`/api/events/${id}`, { headers });
    expect(response.status()).toBe(200);
    return eventResponseSchema.parse(await response.json());
  };
  expect(await read()).toMatchObject({
    startsOn: "2030-07-03",
    endsOn: "2030-07-12",
    startsAt: null,
    endsAt: null,
  });
  await expect(page.getByLabel("Object ID", { exact: true })).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Date precision").selectOption("timed");
  await page.getByLabel("Start time", { exact: true }).fill("09:30");
  await page.getByLabel("End time (optional)", { exact: true }).fill("18:00");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit event", exact: true }),
  ).toBeVisible();
  const timed = await read();
  expect(timed).toMatchObject({ id, startsOn: null, endsOn: null, version: 2 });
  expect(
    Date.parse(timed.endsAt ?? "") - Date.parse(timed.startsAt ?? ""),
  ).toBeGreaterThan(8 * 86_400_000);
  await page.reload();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue(
    "2030-07-03",
  );
  await expect(
    page.getByLabel("End date (optional)", { exact: true }),
  ).toHaveValue("2030-07-12");
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
    "09:30",
  );
});

for (const display of [
  {
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    day: "28",
  },
  { locale: "de-DE", timezoneId: "Asia/Tokyo", day: "01" },
]) {
  test.describe(`${display.locale} in ${display.timezoneId}`, () => {
    test.use({ locale: display.locale, timezoneId: display.timezoneId });

    test("keeps date badges consistent across event and planning views", async ({
      page,
      request,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const email = `dates-${randomUUID()}@example.test`;
      const identity = await request.post("/api/auth/development/sign-in", {
        data: { email, displayName: "Event planner" },
      });
      expect(identity.status()).toBe(200);
      const session = await identity.json();
      const headers = { authorization: `Bearer ${session.accessToken}` };
      const timestamp = "2026-03-01T00:30:00.000Z";
      const created = await request.post("/api/events", {
        headers,
        data: {
          displayName: "Month boundary",
          startsAt: timestamp,
          timezone: "UTC",
        },
      });
      expect(created.status()).toBe(201);
      const event = eventResponseSchema.parse(await created.json());
      const unscheduled = await request.post("/api/events", {
        headers,
        data: { displayName: "Unscheduled plan" },
      });
      expect(unscheduled.status()).toBe(201);
      for (const resource of [
        {
          objectType: "event",
          displayName: "Scheduled item",
          startsAt: timestamp,
          timezone: "UTC",
        },
        {
          objectType: "reminder",
          displayName: "Planning reminder",
          remindAt: timestamp,
        },
      ]) {
        const response = await request.post(
          `/api/events/${event.id}/resources`,
          {
            headers,
            data: { commandId: randomUUID(), resource },
          },
        );
        expect(response.status()).toBe(201);
      }

      await page.goto("/sign-in");
      await page.getByLabel("Name", { exact: true }).fill("Event planner");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Continue" }).click();
      const month = await page.evaluate(
        ({ locale, timezoneId, timestamp }) =>
          new Intl.DateTimeFormat(locale, {
            month: "short",
            timeZone: timezoneId,
          }).format(new Date(timestamp)),
        { ...display, timestamp },
      );
      const card = page.getByRole("link", { name: /Month boundary/ });
      await expect(card.locator(".event-date-mark span")).toHaveText(
        month.toUpperCase(),
      );
      await expect(card.locator(".event-date-mark strong")).toHaveText(
        display.day,
      );
      const undated = page.getByRole("link", { name: /Unscheduled plan/ });
      await expect(undated.locator(".event-date-mark span")).toHaveText("TBD");
      await expect(undated.locator(".event-date-mark strong")).toHaveText("-");
      await card.click();
      await page.getByRole("tab", { name: "Calendar", exact: true }).click();
      const calendar = page
        .locator(".calendar-item")
        .filter({ hasText: "Scheduled item" });
      await expect(calendar.locator("time span")).toHaveText(
        month.toUpperCase(),
      );
      await expect(calendar.locator("time strong")).toHaveText(display.day);
      await page.screenshot({
        path: testInfo.outputPath("calendar-date.png"),
        fullPage: true,
      });
      await page.getByRole("tab", { name: "Reminders", exact: true }).click();
      await expect(page.locator(".reminder-time span")).toHaveText(month);
      await expect(page.locator(".reminder-time strong")).toHaveText(
        display.day,
      );
      expect(errors).toEqual([]);
    });
  });
}

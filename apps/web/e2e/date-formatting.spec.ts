import { randomUUID } from "node:crypto";
import { eventResponseSchema } from "@chronelle/schemas";
import { expect, test } from "@playwright/test";

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

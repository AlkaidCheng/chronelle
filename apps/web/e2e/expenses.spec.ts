import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  eventContextCreateResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
} from "@chronelle/schemas";

test("preserves exact expense amounts through editing and currency summaries @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `expenses-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Event planner" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const eventResponse = await request.post("/api/events", {
    headers,
    data: { displayName: "Expense plan", timezone: "UTC" },
  });
  expect(eventResponse.status()).toBe(201);
  const event = eventResponseSchema.parse(await eventResponse.json());
  const resourceIds: string[] = [];
  for (const expense of [
    { displayName: "Venue deposit", amount: "999999999999999.9999" },
    { displayName: "Adjustment", amount: "-0.0001" },
  ]) {
    const response = await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: {
        commandId: randomUUID(),
        resource: {
          ...expense,
          objectType: "expense",
          currency: "USD",
          occurredAt: "2026-09-01T12:00:00.000Z",
        },
      },
    });
    expect(response.status()).toBe(201);
    resourceIds.push(
      eventContextCreateResponseSchema.parse(await response.json()).resource.id,
    );
  }

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.getByRole("link", { name: /Expense plan/ }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  const summary = page.getByRole("button", { name: /Recorded expenses/ });
  await expect(summary).toContainText("$999,999,999,999,999.9998");
  await page.screenshot({
    path: testInfo.outputPath("exact-money-overview.png"),
    fullPage: true,
  });
  await summary.click();
  await expect(page.getByLabel("Expense", { exact: true })).toHaveCount(0);
  const deposit = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Venue deposit" }) });
  await expect(
    deposit.getByText("$999,999,999,999,999.9999", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("-$0.0001", { exact: true })).toBeVisible();

  await deposit.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "Edit expense",
    exact: true,
  });
  await expect(editor.getByLabel("Expense", { exact: true })).toBeFocused();
  expect(
    await page.locator(".money-grid").evaluate((grid) => {
      const bounds = grid.getBoundingClientRect();
      return [...grid.querySelectorAll("input")].every((input) => {
        const field = input.getBoundingClientRect();
        return field.left >= bounds.left && field.right <= bounds.right;
      });
    }),
  ).toBe(true);
  await expect(editor.getByLabel("Amount")).toHaveValue("999999999999999.9999");
  await editor.getByLabel("Amount").fill("999999999999999.9997");
  await editor.getByRole("button", { name: "Save expense" }).click();
  await expect(
    deposit.getByText("$999,999,999,999,999.9997", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Totals by currency")).toContainText(
    "$999,999,999,999,999.9996",
  );
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(summary).toContainText("$999,999,999,999,999.9996");

  await summary.click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Expense", { exact: true }).fill("Supplies");
  const amount = page.getByLabel("Amount", { exact: true });
  let invalidWrites = 0;
  const countWrites = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/api/events/${event.id}/resources`)
    )
      invalidWrites++;
  };
  page.on("request", countWrites);
  for (const invalid of ["1.00001", "1,25", "-", "1000000000000000"]) {
    await amount.fill(invalid);
    await amount.press("ControlOrMeta+Enter");
    expect(
      await amount.evaluate(
        (input: HTMLInputElement) => input.validity.patternMismatch,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("dialog", { name: "Add expense", exact: true }),
    ).toBeVisible();
  }
  expect(invalidWrites).toBe(0);
  page.off("request", countWrites);
  await page.getByLabel("Amount").fill("1.0001");
  await page.getByLabel("Currency", { exact: true }).fill("EUR");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}/resources`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Record expense" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(
    eventContextCreateResponseSchema.parse(await response.json()).resource,
  ).toMatchObject({
    displayName: "Supplies",
    amount: "1.0001",
    currency: "EUR",
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add expense", exact: true }),
  ).toBeFocused();
  const totals = page.getByLabel("Totals by currency");
  await expect(totals.getByText("USD", { exact: true })).toBeVisible();
  await expect(totals.getByText("EUR", { exact: true })).toBeVisible();
  await expect(totals).toContainText("$999,999,999,999,999.9996");
  await expect(totals).toContainText("\u20ac1.0001");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("exact-money-expenses.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(summary).toContainText("3 transactions");
  await page.reload();
  await expect(summary).toContainText("3 transactions");

  const savedResponse = await request.get(`/api/expenses/${resourceIds[0]}`, {
    headers,
  });
  expect(savedResponse.status()).toBe(200);
  expect(expenseResponseSchema.parse(await savedResponse.json())).toMatchObject(
    {
      id: resourceIds[0],
      amount: "999999999999999.9997",
      version: 2,
    },
  );
  const adjustmentResponse = await request.get(
    `/api/expenses/${resourceIds[1]}`,
    { headers },
  );
  expect(adjustmentResponse.status()).toBe(200);
  expect(
    expenseResponseSchema.parse(await adjustmentResponse.json()),
  ).toMatchObject({
    id: resourceIds[1],
    amount: "-0.0001",
    version: 1,
  });
  expect(errors).toEqual([]);
});

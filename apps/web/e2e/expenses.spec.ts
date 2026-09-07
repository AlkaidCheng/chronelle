import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  eventContextCreateResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
} from "@chronelle/schemas";

test("preserves exact expense amounts through editing and currency summaries", async ({
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

  await page.goto("/sign-in");
  await page.getByLabel("Name", { exact: true }).fill("Event planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}`);
  const summary = page.getByRole("button", { name: /Recorded expenses/ });
  await expect(summary).toContainText("$999,999,999,999,999.9998");
  await page.screenshot({
    path: testInfo.outputPath("exact-money-overview.png"),
    fullPage: true,
  });
  await summary.click();
  expect(
    await page.locator(".money-grid").evaluate((grid) => {
      const bounds = grid.getBoundingClientRect();
      return [...grid.querySelectorAll("input")].every((input) => {
        const field = input.getBoundingClientRect();
        return field.left >= bounds.left && field.right <= bounds.right;
      });
    }),
  ).toBe(true);
  const deposit = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Venue deposit" }) });
  await expect(
    deposit.getByText("$999,999,999,999,999.9999", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("-$0.0001", { exact: true })).toBeVisible();

  await deposit.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".editor-drawer");
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
  await page.getByLabel("Expense", { exact: true }).fill("Supplies");
  await page.getByLabel("Amount").fill("1.0001");
  await page.getByLabel("Currency", { exact: true }).fill("EUR");
  await page.getByRole("button", { name: "Record expense" }).click();
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

import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  eventContextCreateResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
} from "@livtales/schemas";
import { openEventView } from "./helpers/event-view";
import {
  chip,
  composer,
  openAddComposer,
  pressRow,
  setAmountChip,
  submitComposer,
} from "./helpers/record-composers";

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
  await openEventView(page, "Overview");
  const summary = page.getByRole("button", { name: /^Expenses/ });
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

  // The row opens in place; the Amount chip's panel keeps the exact text.
  await pressRow(deposit, "Venue deposit");
  const editor = composer(page, "Edit Venue deposit");
  await expect(
    editor.getByLabel("What was paid for", { exact: true }),
  ).toBeFocused();
  await chip(editor, /^Amount/).click();
  expect(
    await page.locator(".chip-panel .money-grid").evaluate((grid) => {
      const bounds = grid.getBoundingClientRect();
      return [...grid.querySelectorAll("input")].every((input) => {
        const field = input.getBoundingClientRect();
        return field.left >= bounds.left && field.right <= bounds.right;
      });
    }),
  ).toBe(true);
  const amountField = editor.getByRole("textbox", {
    name: "Amount",
    exact: true,
  });
  await expect(amountField).toHaveValue("999999999999999.9999");
  await amountField.fill("999999999999999.9997");
  await amountField.press("Enter");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    deposit.getByText("$999,999,999,999,999.9997", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Totals by currency")).toContainText(
    "$999,999,999,999,999.9996",
  );
  await openEventView(page, "Overview");
  await expect(summary).toContainText("$999,999,999,999,999.9996");

  await summary.click();
  // The add row's composer refuses an amount the API would, before any
  // request, and opens the Amount chip on the refusal.
  const adding = await openAddComposer(
    page.locator(".planning-panel").filter({
      has: page.getByRole("heading", { name: "Expenses", exact: true }),
    }),
    "Add expense",
    "New expense",
    "Supplies",
  );
  const name = adding.getByLabel("What was paid for", { exact: true });
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
    await setAmountChip(adding, invalid);
    await name.press("ControlOrMeta+Enter");
    await expect(adding.getByRole("alert")).toHaveText(
      "Enter an amount and a three-letter currency.",
    );
    await expect(
      adding.getByRole("textbox", { name: "Amount", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
  }
  expect(invalidWrites).toBe(0);
  page.off("request", countWrites);
  await setAmountChip(adding, "1.0001", "EUR");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}/resources`) &&
      response.request().method() === "POST",
  );
  await submitComposer(adding);
  const response = await created;
  expect(response.status()).toBe(201);
  expect(
    eventContextCreateResponseSchema.parse(await response.json()).resource,
  ).toMatchObject({
    displayName: "Supplies",
    amount: "1.0001",
    currency: "EUR",
  });
  await expect(name).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(adding).toHaveCount(0);
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
  await openEventView(page, "Overview");
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

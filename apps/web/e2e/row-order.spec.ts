import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseRowOrder } from "./helpers/row-order";

test("reorders tasks by drag and from the row menu, and moves them between days @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}) => {
  const email = `rows-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "A hall to book" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /A hall to book/ }).click();
  await exerciseRowOrder(page);

  // Every move wrote only the moved task (Call the band: the first drag;
  // Order the cake: Due, then the Tasks page drag; Book the hall: Move
  // down, then the drop under Tomorrow), and the API lists the order.
  const listed = await (
    await request.get(`/api/tasks?sort=manual&query=the`, { headers })
  ).json();
  expect(event.id).toEqual(expect.any(String));
  expect(
    listed.items.map((item: { displayName: string; version: number }) => [
      item.displayName,
      item.version,
    ]),
  ).toEqual([
    ["Call the band", 2],
    ["Book the hall", 3],
    ["Order the cake", 3],
  ]);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const pad = (part: number) => String(part).padStart(2, "0");
  const tomorrowKey = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  expect(
    listed.items.map((item: { dueOn: string | null }) => item.dueOn),
  ).toEqual([null, tomorrowKey, tomorrowKey]);
  expect(errors).toEqual([]);
});

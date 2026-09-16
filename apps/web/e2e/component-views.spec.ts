import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseComponentViews } from "./helpers/component-views";

test("keeps a component's chosen view in the shared layout", async ({
  page,
  request,
}) => {
  const email = `views-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "A weekend to plan" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /A weekend to plan/ }).click();
  await exerciseComponentViews(page);
  const layout = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  // Each chosen view and the added component saved a version; moving the
  // period saved none.
  expect(layout.version).toBe(7);
  expect(layout.pages[0].components).toEqual([
    { id: expect.any(String), kind: "todos", view: "month" },
    { id: expect.any(String), kind: "expenses", view: "month" },
  ]);
  const history = await (
    await request.get(`/api/events/${event.id}/layout/history`, { headers })
  ).json();
  expect(
    history.items.map((item: { version: number }) => item.version),
  ).toEqual([7, 6, 5, 4, 3, 2, 1]);
  expect(errors).toEqual([]);
});

import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  exerciseQuickAddInEvent,
  exerciseQuickAddOnTasksPage,
} from "./helpers/quick-add";
import { today } from "./helpers/today";

test("adds tasks and reminders from the quick row at the end of a collection @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}) => {
  const email = `quick-add-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Harvest supper" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Harvest supper/ }).click();

  const added = await exerciseQuickAddInEvent(page);
  const todos = await (
    await request.get(`/api/events/${event.id}/todos`, { headers })
  ).json();
  const byName = new Map(
    todos.items.map((task: { displayName: string }) => [
      task.displayName,
      task,
    ]),
  );
  expect(byName.get(added.tasks.dated)).toMatchObject({
    dueOn: today(),
    dueAt: null,
  });
  for (const name of added.tasks.undated)
    expect(byName.get(name)).toMatchObject({ dueOn: null, dueAt: null });
  const reminders = await (
    await request.get(`/api/events/${event.id}/reminders`, { headers })
  ).json();
  for (const name of added.reminders) {
    const reminder = reminders.items.find(
      (item: { displayName: string }) => item.displayName === name,
    );
    expect(reminder).toBeDefined();
    const at = new Date(reminder.remindAt);
    expect([at.getHours(), at.getMinutes()]).toEqual([9, 0]);
  }

  const names = await exerciseQuickAddOnTasksPage(page);
  const listed = await (
    await request.get("/api/tasks?filter=open", { headers })
  ).json();
  for (const name of names)
    expect(
      listed.items.find(
        (task: { displayName: string }) => task.displayName === name,
      ),
    ).toMatchObject({ dueOn: null, dueAt: null });
  expect(errors).toEqual([]);
});

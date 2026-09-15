import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exerciseTasksPage } from "./helpers/tasks-page";

test("lists, creates, and completes tasks outside an event", async ({
  page,
  request,
}) => {
  const email = `tasks-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  const name = await exerciseTasksPage(page, "Planner");
  const listed = await (
    await request.get("/api/tasks?filter=done", { headers })
  ).json();
  expect(listed.items).toMatchObject([
    { displayName: name, dueOn: "2031-05-20", status: "done" },
  ]);
  expect(listed.items[0].permissionScopeId).toBe(listed.items[0].id);
  expect(errors).toEqual([]);
});

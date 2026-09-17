import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exercisePeoplePage } from "./helpers/people-page";
import { chooseRowAction } from "./helpers/row-menu";

test("keeps people as namecards with chosen fields", async ({
  page,
  request,
}) => {
  const email = `people-${randomUUID()}@example.test`;
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
  const name = await exercisePeoplePage(page);
  const listed = await (await request.get("/api/persons", { headers })).json();
  expect(listed.items).toMatchObject([
    {
      displayName: name,
      nickname: "Mira",
      email: "mira@example.test",
      contacts: [{ kind: "email", value: "mira@example.test" }],
      userId: session.user.id,
      customProperties: { diet: "Vegetarian dishes" },
      version: 2,
    },
  ]);
  expect(listed.items[0].labelIds).toHaveLength(1);

  // A task assigned to the person names them by nickname.
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Tasks", exact: true })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add task", exact: true });
  await editor.getByLabel("Task", { exact: true }).fill("Call about the trip");
  await editor.getByText("Assignee: Unassigned", { exact: true }).click();
  await editor.getByRole("radio", { name: "Mira (me)", exact: true }).check();
  await editor
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const row = page.getByRole("row", { name: /Call about the trip/ });
  await expect(row.getByText("Assigned to Mira")).toBeAttached();
  await chooseRowAction(page, row, "Edit");
  await expect(
    page
      .getByRole("dialog", { name: "Edit task", exact: true })
      .getByText("Assignee: Mira", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

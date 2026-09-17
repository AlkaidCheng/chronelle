import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { moveToTrash } from "./helpers/lifecycle";
import { exercisePeoplePage } from "./helpers/people-page";
import { openTrash } from "./helpers/quiet-chrome";
import { chooseRowAction } from "./helpers/row-menu";

test("keeps people as rows and namecards with a page for each", async ({
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
    { displayName: "adam", nickname: null, userId: null },
    {
      displayName: name,
      nickname: "Mira",
      email: "mira@example.test",
      contacts: [
        { kind: "email", value: "mira@example.test" },
        { kind: "phone", value: "+1 555 0100" },
      ],
      userId: session.user.id,
      customProperties: { diet: "Vegetarian" },
      version: 2,
    },
  ]);
  const [, mira] = listed.items;
  expect(mira.labelIds).toHaveLength(1);

  // A task assigned to the person names them by nickname, and the
  // person's page lists it under Tasks.
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
  await expect(
    page
      .getByRole("row", { name: /Call about the trip/ })
      .getByText("Assigned to Mira"),
  ).toBeAttached();
  await page.goto(`/people/${mira.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mira");
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await expect(
    page
      .getByRole("tabpanel")
      .getByRole("link", { name: "Call about the trip", exact: true }),
  ).toBeVisible();

  // The row menu moves a person to the Trash, and the Trash restores them.
  await page.getByRole("link", { name: "All people", exact: true }).click();
  const adam = page.getByRole("listitem", { name: "adam", exact: true });
  await chooseRowAction(page, adam, "Move to Trash");
  await moveToTrash(page, page.getByRole("dialog"));
  await openTrash(page);
  await page
    .getByRole("button", { name: "Preview recovery for adam", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm recovery" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Recovered as version",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/people");
  await expect(
    page.getByRole("listitem", { name: "adam", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";
import { chooseRowAction } from "./helpers/row-menu";

/**
 * Sections in an Event's To-dos and Expenses: Add section between groups
 * with a description, a task placed by a section's add row, Edit section
 * from its menu, Move down, a task dragged into another section by its
 * grip (on desktop; the phone moves it through the editor's Section
 * field), Delete section leaving its task loose; then an expense added
 * into a section, the section's total on its head, and the expense moved
 * out through its editor. The API lists the sections and each record's
 * section as the page shows them.
 */
test("splits To-dos and Expenses into sections, places records by add row, editor, and drag, and leaves them loose on delete", async ({
  isMobile,
  page,
  request,
}) => {
  const email = `sections-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
    "x-workspace-id": session.workspace.id,
  };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Autumn fair" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Autumn fair/ }).click();

  await openEventView(page, "To-dos");
  const todos = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await expect(todos).toBeVisible();
  const quickAdd = async (name: string) => {
    const field = todos.getByLabel("New task", { exact: true });
    await todos
      .getByRole("button", { name: "Add a task to the list", exact: true })
      .click();
    await field.fill(name);
    await field.press("Enter");
    await expect(
      todos.getByRole("row", { name: new RegExp(name) }),
    ).toBeVisible();
    await field.press("Escape");
  };
  await quickAdd("Book the hall");
  await quickAdd("Order the cake");

  // Add section under the loose rows: the pill shows on hover, the editor
  // takes a name and a description, Enter saves.
  const addSectionAt = async (at: number, name: string, description = "") => {
    const lines = todos.getByRole("button", { name: "Add section" });
    await lines.nth(at).hover();
    await lines.nth(at).click();
    const editor = todos.getByRole("form", { name: "Add section" });
    await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
    await editor.getByLabel("Section name").fill(name);
    if (description !== "")
      await editor.getByLabel("Description (optional)").fill(description);
    await editor.getByLabel("Section name").press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(
      todos.locator(".section-name", { hasText: name }),
    ).toBeVisible();
  };
  const sectionNames = () => todos.locator(".section-name").allTextContents();
  await addSectionAt(0, "Logistics");
  await addSectionAt(1, "Music");
  // Between the two, with a description under the name.
  await addSectionAt(1, "Catering", "Who brings what");
  await expect.poll(sectionNames).toEqual(["Logistics", "Catering", "Music"]);
  await expect(todos.getByText("Who brings what")).toBeVisible();
  const sectionOf = (name: string) =>
    todos.locator("tbody.section-body").filter({
      has: page.locator(".section-name", { hasText: name }),
    });
  const headOf = (name: string) => sectionOf(name).locator(".section-head");

  // A task from the section's own add row lands in the section; the head
  // counts it.
  await sectionOf("Catering")
    .getByRole("button", { name: "Add a task to Catering", exact: true })
    .click();
  const field = todos.getByLabel("New task", { exact: true });
  await field.fill("Book the caterer");
  await field.press("Enter");
  await expect(
    sectionOf("Catering").getByText("Book the caterer"),
  ).toBeVisible();
  await field.press("Escape");
  await expect(headOf("Catering").locator(".section-figure")).toHaveText("1");

  // Edit section opens the editor prefilled; Escape cancels, Enter saves.
  await chooseRowAction(page, headOf("Catering"), "Edit section");
  const edit = todos.getByRole("form", { name: "Edit section" });
  await expect(edit.getByLabel("Section name")).toHaveValue("Catering");
  await edit.getByLabel("Section name").press("Escape");
  await expect(edit).toHaveCount(0);
  await chooseRowAction(page, headOf("Catering"), "Edit section");
  await edit.getByLabel("Section name").fill("Food");
  await edit.getByLabel("Section name").press("Enter");
  await expect.poll(sectionNames).toEqual(["Logistics", "Food", "Music"]);

  // Move down from the menu.
  await chooseRowAction(page, headOf("Food"), "Move down");
  await expect.poll(sectionNames).toEqual(["Logistics", "Music", "Food"]);

  // The hall into Music: by its grip on desktop, where the lifted row
  // becomes a card and a gap marks the landing spot; through the editor's
  // Section field on the phone.
  const hall = todos.getByRole("row", { name: /Book the hall/ });
  if (isMobile) {
    await chooseRowAction(page, hall, "Edit");
    const taskEditor = page.getByRole("dialog", { name: "Edit task" });
    await taskEditor.getByLabel("Section", { exact: true }).selectOption({
      label: "Music",
    });
    await taskEditor.getByRole("button", { name: "Save task" }).click();
    await expect(taskEditor).toHaveCount(0);
  } else {
    await hall.hover();
    const grip = hall.getByRole("button", { name: "Reorder Book the hall" });
    await expect(grip).toBeVisible();
    const from = await grip.boundingBox();
    if (!from) throw new Error("The grip is not visible");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 4 });
    await expect(page.locator(".row-drag-card")).toContainText("Book the hall");
    const musicHead = await headOf("Music").boundingBox();
    if (!musicHead) throw new Error("The Music head is not visible");
    await page.mouse.move(from.x, musicHead.y + musicHead.height + 8, {
      steps: 8,
    });
    await expect(sectionOf("Music").locator(".row-gap-row")).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator(".row-drag-card")).toHaveCount(0);
  }
  await expect(sectionOf("Music").getByText("Book the hall")).toBeVisible();

  // Delete section: its task stays in the list, loose.
  await chooseRowAction(page, headOf("Food"), "Delete section");
  await expect.poll(sectionNames).toEqual(["Logistics", "Music"]);
  await expect(
    todos.getByRole("row", { name: /Book the caterer/ }),
  ).toBeVisible();
  const listed = await (
    await request.get(`/api/events/${event.id}/todos`, { headers })
  ).json();
  const musicSection = listed.sections.find(
    (section: { name: string }) => section.name === "Music",
  );
  expect(
    listed.sections.map((section: { name: string }) => section.name),
  ).toEqual(["Logistics", "Music"]);
  expect(
    Object.fromEntries(
      listed.items.map(
        (item: { displayName: string; sectionId: string | null }) => [
          item.displayName,
          item.sectionId,
        ],
      ),
    ),
  ).toEqual({
    "Book the hall": musicSection.id,
    "Order the cake": null,
    "Book the caterer": null,
  });

  // Expenses: a section, an expense added from its add row with the
  // section chosen, the total on the head, and the expense moved out
  // through its editor.
  await openEventView(page, "Expenses");
  const expenses = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Expenses", exact: true }),
  });
  await expect(expenses).toBeVisible();
  const line = expenses.getByRole("button", { name: "Add section" }).first();
  await line.hover();
  await line.click();
  const sectionEditor = expenses.getByRole("form", { name: "Add section" });
  await sectionEditor.getByLabel("Section name").fill("Travel");
  await sectionEditor.getByLabel("Section name").press("Enter");
  const travel = expenses.getByRole("region", { name: "Travel" });
  await expect(travel).toBeVisible();
  await travel
    .getByRole("button", { name: "Add expense", exact: true })
    .click();
  const expenseEditor = page.getByRole("dialog", {
    name: "Add expense",
    exact: true,
  });
  await expect(
    expenseEditor.getByLabel("Section", { exact: true }),
  ).toHaveValue(/./);
  await expect(
    expenseEditor
      .getByLabel("Section", { exact: true })
      .locator("option:checked"),
  ).toHaveText("Travel");
  await expenseEditor.getByLabel("Expense", { exact: true }).fill("Train fare");
  await expenseEditor.getByLabel("Amount", { exact: true }).fill("42.50");
  await expenseEditor
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(expenseEditor).toHaveCount(0);
  await expect(travel.getByText("Train fare")).toBeVisible();
  await expect(travel.locator(".section-figure")).toContainText("42.50");

  await travel.getByRole("button", { name: "Edit", exact: true }).click();
  const editExpense = page.getByRole("dialog", { name: "Edit expense" });
  await editExpense
    .getByLabel("Section", { exact: true })
    .selectOption({ label: "No section" });
  await editExpense.getByRole("button", { name: "Save expense" }).click();
  await expect(editExpense).toHaveCount(0);
  await expect(travel.getByText("Train fare")).toHaveCount(0);
  await expect(expenses.getByText("Train fare")).toBeVisible();
  const spend = await (
    await request.get(`/api/events/${event.id}/expenses`, { headers })
  ).json();
  expect(
    spend.sections.map((section: { name: string }) => section.name),
  ).toEqual(["Travel"]);
  expect(spend.items[0]).toMatchObject({
    displayName: "Train fare",
    sectionId: null,
    version: 2,
  });
  expect(errors).toEqual([]);
});

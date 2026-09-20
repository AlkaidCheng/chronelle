import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { chooseLayout } from "./helpers/component-views";
import { today } from "./helpers/today";

/** A calendar day some days from today, as a due date field takes it. */
function dayFromToday(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

test("lays the To-dos out as a board of the days that hold tasks, Overdue and Today first @webkit-desktop", async ({
  page,
  request,
}) => {
  const email = `board-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Wedding countdown" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const lateDay = dayFromToday(-4);
  const laterDay = dayFromToday(-2);
  const soonDay = dayFromToday(4);
  const farDay = dayFromToday(22);
  const tasks: Record<string, { id: string; version: number }> = {};
  for (const [displayName, dueOn] of [
    ["Chase the last RSVPs", lateDay],
    ["Order the flowers", laterDay],
    ["Call the band", today()],
    ["Walk the venue with the planner", soonDay],
    ["Cake tasting", soonDay],
    ["Draft the seating plan", farDay],
  ] as const) {
    const added = await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: {
        commandId: randomUUID(),
        resource: { objectType: "task", displayName, dueOn },
      },
    });
    expect(added.status()).toBe(201);
    tasks[displayName] = (await added.json()).resource;
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Wedding countdown/ }).click();
  // A page's To-dos component keeps its layout with the page.
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const addPage = page.getByRole("dialog", { name: "Add a page" });
  await addPage.getByLabel("Page name").fill("Preparation");
  await addPage.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(addPage).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Add a component" });
  await picker.getByRole("button", { name: "Add To-dos", exact: true }).click();
  await expect(picker).toHaveCount(0);
  const panel = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await chooseLayout(panel, "Board");
  await expect(page.getByText("Shown as a board.")).toBeAttached();

  // Only the days that hold tasks are columns, in date order, with
  // Overdue first (the two late tasks, oldest first) and Today; the days
  // between are absent, so a month of tasks reads in one sweep.
  const columns = panel.locator(".board-column");
  await expect(columns).toHaveCount(4);
  await expect(columns.locator(".board-title")).toHaveText([
    "Overdue",
    /Today$/,
    /./,
    /./,
  ]);
  await expect(columns.nth(0)).toHaveClass(/is-overdue/);
  await expect(columns.nth(1)).toHaveClass(/is-today/);
  const overdue = columns.nth(0);
  const todayColumn = columns.nth(1);
  const soon = columns.nth(2);
  const far = columns.nth(3);
  const cardsOf = (column: typeof overdue) =>
    column.locator(".resource-list-cards > li");
  await expect(cardsOf(overdue).locator("strong")).toHaveText([
    "Chase the last RSVPs",
    "Order the flowers",
  ]);
  await expect(cardsOf(todayColumn).locator("strong")).toHaveText([
    "Call the band",
  ]);
  await expect(cardsOf(soon).locator("strong")).toHaveText([
    "Walk the venue with the planner",
    "Cake tasting",
  ]);
  await expect(cardsOf(far).locator("strong")).toHaveText([
    "Draft the seating plan",
  ]);
  // The columns scroll sideways as a strip; a card carries no date since
  // its column is the date.
  await expect(panel.locator(".board-strip")).toBeVisible();
  await expect(cardsOf(todayColumn).first()).not.toContainText(/\d{4}/);

  // A drop on another column writes its day: the band moves to the soon
  // day, one versioned write of the moved task.
  // The strip scrolls sideways (a phone shows a column and a half), so
  // the source card is brought into view before the press and the target
  // column while the card is lifted; the lifted card follows the pointer.
  const band = cardsOf(todayColumn).filter({ hasText: "Call the band" });
  await band.scrollIntoViewIfNeeded();
  const box = await band.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2 + 12, { steps: 4 });
  await expect(page.locator(".row-drag-card")).toBeVisible();
  await soon.scrollIntoViewIfNeeded();
  const soonBox = await soon.boundingBox();
  expect(soonBox).not.toBeNull();
  if (soonBox === null) return;
  await page.mouse.move(soonBox.x + soonBox.width / 2, soonBox.y + 60, {
    steps: 8,
  });
  await expect(soon.locator(".row-gap")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".row-drag-card")).toHaveCount(0);
  await expect(cardsOf(soon)).toHaveCount(3);
  await expect(cardsOf(todayColumn)).toHaveCount(0);
  await expect(panel.getByText(/^Call the band is due /)).toBeAttached();
  const bandTask = tasks["Call the band"];
  expect(bandTask).toBeDefined();
  if (bandTask === undefined) return;
  const moved = await (
    await request.get(`/api/tasks/${bandTask.id}`, { headers })
  ).json();
  expect(moved).toMatchObject({
    dueOn: soonDay,
    version: bandTask.version + 1,
  });

  // Today stays as a column even when empty, since its add row lives
  // there: the row presets today.
  await todayColumn.scrollIntoViewIfNeeded();
  await expect(todayColumn).toBeVisible();
  // The strip scrolls sideways under the page, so the row is pressed where
  // it is measured rather than re-scrolled into place by the click.
  const addRow = todayColumn.getByRole("button", { name: /^Add a task for / });
  await addRow.scrollIntoViewIfNeeded();
  const addBox = await addRow.boundingBox();
  expect(addBox).not.toBeNull();
  if (addBox === null) return;
  await page.mouse.click(addBox.x + 30, addBox.y + addBox.height / 2);
  const composer = todayColumn.getByLabel("Task name", { exact: true });
  await expect(composer).toBeFocused();
  await composer.fill("Confirm the caterer");
  await composer.press("Enter");
  await expect(cardsOf(todayColumn).locator("strong")).toHaveText([
    "Confirm the caterer",
  ]);
  const listed = await (
    await request.get(`/api/events/${event.id}/todos`, { headers })
  ).json();
  expect(
    listed.items.find(
      (item: { displayName: string }) =>
        item.displayName === "Confirm the caterer",
    ),
  ).toMatchObject({ dueOn: today() });

  // Reschedule at Overdue's head moves every overdue task to today, each
  // its own versioned write, said once.
  await overdue.scrollIntoViewIfNeeded();
  await overdue
    .getByRole("button", { name: "Reschedule", exact: true })
    .click();
  await expect(panel.getByText("Moved 2 tasks to today.")).toBeAttached();
  await expect(columns).toHaveCount(3);
  await expect(columns.nth(0)).toHaveClass(/is-today/);
  // The moved tasks keep their manual order, so they read before the task
  // added a moment ago.
  await expect(cardsOf(columns.nth(0)).locator("strong")).toHaveText([
    "Chase the last RSVPs",
    "Order the flowers",
    "Confirm the caterer",
  ]);
  for (const name of ["Chase the last RSVPs", "Order the flowers"] as const) {
    const task = tasks[name];
    expect(task).toBeDefined();
    if (task === undefined) continue;
    const rescheduled = await (
      await request.get(`/api/tasks/${task.id}`, { headers })
    ).json();
    expect(rescheduled.dueOn).toBe(today());
    expect(rescheduled.version).toBeGreaterThan(task.version);
  }

  // The layout is kept on the component: a reload opens the board.
  await page.reload();
  const reopened = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await expect(
    reopened.getByRole("button", { name: "Layout: Board", exact: true }),
  ).toBeVisible();
  await expect(reopened.locator(".board-column")).toHaveCount(3);
  const layout = await (
    await request.get(`/api/events/${event.id}/layout`, { headers })
  ).json();
  expect(
    layout.pages.flatMap((entry: { components: { view?: string }[] }) =>
      entry.components.map((component) => component.view),
    ),
  ).toContain("board");
  expect(errors).toEqual([]);
});

import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { chooseLayout } from "./helpers/component-views";
import { openEventView } from "./helpers/event-view";
import { chooseRowAction, dragRow } from "./helpers/row-menu";
import { today } from "./helpers/today";

/** A calendar day some days from today, as a due date field takes it. */
function dayFromToday(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

test("lays a week's tasks out as cards that drag between days, each day with its own add row @webkit-desktop", async ({
  page,
  request,
}) => {
  const email = `week-${randomUUID()}@example.test`;
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
  const tasks: Record<string, { id: string; version: number }> = {};
  for (const [displayName, dueOn] of [
    ["Walk the venue with the planner", today()],
    ["Call the band", today()],
    ["Confirm the dress sizes and the flowers", today()],
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
  await openEventView(page, "To-dos");
  const panel = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "To-dos", exact: true }),
  });
  await chooseLayout(panel, "By week");

  // Today's column holds the three tasks as cards, bordered and 6px apart;
  // the day head's rule is the only rule in the grid.
  const todayColumn = panel.locator(".week-day.is-today");
  const cards = todayColumn.locator(".resource-list-cards > li");
  await expect(cards).toHaveCount(3);
  // Seven columns of 180px scroll sideways at the window's width.
  await todayColumn.scrollIntoViewIfNeeded();
  const first = cards.filter({ hasText: "Walk the venue" });
  const second = cards.filter({ hasText: "Call the band" });
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  if (firstBox === null || secondBox === null) return;
  expect(Math.round(secondBox.y - (firstBox.y + firstBox.height))).toBe(6);
  await expect(first).toHaveCSS("border-top-width", "1px");
  // The title clamps to two lines and keeps the menu's gutter free at the
  // right, so nothing moves when the controls appear.
  const title = first.locator("strong");
  const before = await title.boundingBox();
  await first.hover();
  const menu = first.getByRole("button", { name: /^Actions for / });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  const after = await title.boundingBox();
  expect(after).toEqual(before);
  expect(menuBox).not.toBeNull();
  if (menuBox === null || before === null) return;
  // The menu sits inside the card's top right corner, the grip at its
  // left edge outside the text.
  expect(menuBox.y - firstBox.y).toBeLessThan(8);
  expect(
    firstBox.x + firstBox.width - (menuBox.x + menuBox.width),
  ).toBeLessThan(8);
  expect(menuBox.x).toBeGreaterThan(before.x + before.width);
  const grip = first.getByRole("button", {
    name: "Reorder Walk the venue with the planner",
  });
  await expect(grip).toBeVisible();
  const gripBox = await grip.boundingBox();
  expect(gripBox).not.toBeNull();
  if (gripBox === null) return;
  expect(gripBox.x).toBeLessThan(firstBox.x);

  // The menu's Edit opens the full editor, since a card has no room for
  // the composer.
  await chooseRowAction(page, first, "Edit");
  const editor = page.getByRole("dialog", { name: "Edit task", exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toHaveCount(0);

  // A drag by the card moves it within its day: the band lands before the
  // venue walk, one versioned write of the moved task.
  await dragRow(page, second, first, "before");
  await expect(cards.locator("strong")).toHaveText([
    "Call the band",
    "Walk the venue with the planner",
    "Confirm the dress sizes and the flowers",
  ]);
  await expect(panel.getByRole("status")).toHaveText("Call the band moved.");

  // A drop on another day's column writes that day: the neighbouring day,
  // empty until then, takes the card.
  const columns = panel.locator(".week-day");
  const todayAt = await columns.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.classList.contains("is-today")),
  );
  const offset = todayAt === 6 ? -1 : 1;
  const target = columns.nth(todayAt + offset);
  const targetDay = dayFromToday(offset);
  await expect(target.locator(".resource-list-cards > li")).toHaveCount(0);
  const box = await second.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2 + 12, { steps: 4 });
  await expect(page.locator(".row-drag-card")).toBeVisible();
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  if (targetBox === null) return;
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 80, {
    steps: 8,
  });
  await expect(target.locator(".row-gap")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".row-drag-card")).toHaveCount(0);
  await expect(target.getByText("Call the band")).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect(panel.getByRole("status")).toHaveText(/^Call the band is due /);
  const band = tasks["Call the band"];
  expect(band).toBeDefined();
  if (band === undefined) return;
  const moved = await (
    await request.get(`/api/tasks/${band.id}`, { headers })
  ).json();
  expect(moved).toMatchObject({ dueOn: targetDay, version: band.version + 2 });

  // Each day ends in an add row that presets the day: the task lands in
  // that column, due on its day.
  await target.hover();
  await target.getByRole("button", { name: /^Add a task for / }).click();
  const composer = target.getByLabel("Task name", { exact: true });
  await expect(composer).toBeFocused();
  await composer.fill("Cake tasting");
  await composer.press("Enter");
  await expect(target.locator(".resource-list-cards > li")).toHaveCount(2);
  await expect(target.getByText("Cake tasting")).toBeVisible();
  const listed = await (
    await request.get(`/api/events/${event.id}/todos`, { headers })
  ).json();
  expect(
    listed.items.find(
      (item: { displayName: string }) => item.displayName === "Cake tasting",
    ),
  ).toMatchObject({ dueOn: targetDay });
  expect(errors).toEqual([]);
});

import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { moreTrigger, openMoreMenu } from "./helpers/quiet-chrome";

const collections = (page: Page) =>
  page.getByRole("list", { name: "Collections", exact: true });

/** The collection names the rail shows, first to last. */
const shownCollections = (page: Page) =>
  collections(page).getByRole("link").allTextContents();

test("keeps the rail's order and hidden collections on the account @webkit-desktop", async ({
  page,
}, testInfo) => {
  const email = `sidebar-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Rail arranger");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await expect
    .poll(() => shownCollections(page))
    .toEqual(["Events", "Tasks", "People"]);

  // A phone shows the kept order and does not offer arranging.
  if (testInfo.project.name.endsWith("mobile")) {
    const more = await openMoreMenu(page);
    await expect(
      more.getByRole("menuitem", { name: "Customize sidebar", exact: true }),
    ).toHaveCount(0);
    return;
  }

  // Customize from More: hide Tasks, then move People to the top with the
  // keyboard; each change shows at once.
  const more = await openMoreMenu(page);
  await more
    .getByRole("menuitem", { name: "Customize sidebar", exact: true })
    .click();
  await expect(more).toHaveCount(0);
  await page.getByRole("button", { name: "Hide Tasks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show Tasks", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const grip = page.getByRole("button", { name: "Move People", exact: true });
  await grip.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(grip).toBeFocused();
  await expect
    .poll(() => shownCollections(page))
    .toEqual(["People", "Events", "Tasks"]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => shownCollections(page)).toEqual(["People", "Events"]);
  await expect(page.getByRole("button", { name: /^Move /u })).toHaveCount(0);

  // The account keeps both across a reload; a hidden collection is still a
  // page, reachable from the palette, and shows in the rail while open.
  await page.reload();
  await expect.poll(() => shownCollections(page)).toEqual(["People", "Events"]);
  await page.goto("/tasks");
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => shownCollections(page))
    .toEqual(["People", "Events", "Tasks"]);
  await expect(
    collections(page).getByRole("link", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // Show Tasks again from the pencil beside the heading; the order stays.
  await page
    .getByRole("button", { name: "Customize sidebar", exact: true })
    .click();
  await page.getByRole("button", { name: "Show Tasks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hide Tasks", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto("/events");
  await expect
    .poll(() => shownCollections(page))
    .toEqual(["People", "Events", "Tasks"]);
  await expect(moreTrigger(page)).toBeVisible();
});

test("arranges the rail with a finger on the grip on a tablet @webkit-desktop", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name.endsWith("mobile"),
    "A phone's rail is a bar without arranging.",
  );
  // A tablet: wide enough for the rail, with touch.
  const context = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    hasTouch: true,
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/sign-in/development");
    await page.getByLabel("Name", { exact: true }).fill("Rail dragger");
    await page.getByLabel("Email").fill(`rail-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/u);
    await expect
      .poll(() => shownCollections(page))
      .toEqual(["Events", "Tasks", "People"]);
    await page
      .getByRole("button", { name: "Customize sidebar", exact: true })
      .click();
    const rows = collections(page).getByRole("listitem");
    const middle = async (index: number) => {
      const box = await rows.nth(index).boundingBox();
      if (box === null) throw new Error(`Row ${index} has no box.`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const touch = { pointerId: 1, pointerType: "touch", isPrimary: true };
    const finger = async (
      type: "pointerdown" | "pointermove" | "pointerup",
      at: { x: number; y: number },
      target = page.locator("body"),
    ) =>
      target.dispatchEvent(type, {
        ...touch,
        bubbles: true,
        clientX: at.x,
        clientY: at.y,
      });

    // A finger on People's grip lifts the row; over the top of Events it
    // drops first.
    const gripBox = await page
      .getByRole("button", { name: "Move People", exact: true })
      .boundingBox();
    if (gripBox === null) throw new Error("The grip has no box.");
    const from = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + 4 };
    await finger(
      "pointerdown",
      from,
      page.getByRole("button", { name: "Move People", exact: true }),
    );
    await expect(rows.nth(2)).toHaveAttribute("data-lifted", "true");
    const top = await middle(0);
    await finger("pointermove", { x: from.x, y: top.y - 8 });
    await expect(rows.nth(0)).toHaveAttribute("data-drop", "before");
    await finger("pointerup", { x: from.x, y: top.y - 8 });
    await expect
      .poll(() => shownCollections(page))
      .toEqual(["People", "Events", "Tasks"]);
    await expect(page.locator("[data-lifted]")).toHaveCount(0);

    // Escape puts a lifted row back where it was.
    const tasksGrip = page.getByRole("button", {
      name: "Move Tasks",
      exact: true,
    });
    const tasksBox = await tasksGrip.boundingBox();
    if (tasksBox === null) throw new Error("The grip has no box.");
    const start = {
      x: tasksBox.x + tasksBox.width / 2,
      y: tasksBox.y + tasksBox.height / 2,
    };
    await finger("pointerdown", start, tasksGrip);
    await finger("pointermove", { x: start.x, y: start.y - 60 });
    await expect(page.locator("[data-lifted]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-lifted]")).toHaveCount(0);
    await expect
      .poll(() => shownCollections(page))
      .toEqual(["People", "Events", "Tasks"]);

    // The order the finger made is on the account.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.reload();
    await expect
      .poll(() => shownCollections(page))
      .toEqual(["People", "Events", "Tasks"]);
  } finally {
    await context.close();
  }
});

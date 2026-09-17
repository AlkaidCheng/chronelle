import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { moreTrigger, openMoreMenu } from "./helpers/quiet-chrome";

const collections = (page: Page) =>
  page.getByRole("list", { name: "Collections", exact: true });

/** The collection names the rail shows, first to last. */
const shownCollections = (page: Page) =>
  collections(page).getByRole("link").allTextContents();

test("keeps the rail's order and hidden collections on the account", async ({
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

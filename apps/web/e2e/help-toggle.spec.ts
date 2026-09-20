import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openCollection } from "./helpers/quiet-chrome";

const control = (scope: Locator | Page, surface: "editor" | "dialog") =>
  scope.getByRole("button", { name: `About this ${surface}`, exact: true });

test("keeps exposition behind the help control of a dialog and off the pages", async ({
  page,
}) => {
  const email = `help-${randomUUID()}@example.test`;
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);

  // The always-visible pages carry no help control.
  await expect(page.getByRole("button", { name: /^About this/ })).toHaveCount(
    0,
  );

  // The event editor: the control sits in the header, opens the entries,
  // and closes on Escape with focus back on it, the dialog staying open;
  // a press outside closes it too.
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create an event" });
  const help = control(create, "editor");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await help.click();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  const popover = create.getByRole("note", { name: "About this editor" });
  await expect(popover.getByRole("term")).toHaveText(["Schedule", "Drafts"]);
  await expect(
    popover.getByText(/Unsaved changes stay in this tab/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(create).toBeVisible();
  await help.click();
  await expect(popover).toBeVisible();
  await create.getByRole("heading", { name: "Create an event" }).click();
  await expect(popover).toHaveCount(0);
  await expect(create).toBeVisible();
  await create.getByLabel("Event name", { exact: true }).fill("Help trial");
  await create
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Help trial", exact: true }),
  ).toBeVisible();

  // The event page itself carries none; its Add a page dialog reads as a
  // dialog and holds the pages' exposition.
  await expect(page.getByRole("button", { name: /^About this/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const addPage = page.getByRole("dialog", { name: "Add a page" });
  await expect(addPage.getByText(/Pages organize this event/)).toHaveCount(0);
  await control(addPage, "dialog").click();
  await expect(
    addPage.getByRole("note", { name: "About this dialog" }).getByRole("term"),
  ).toHaveText(["Pages", "Presets"]);
  await page.keyboard.press("Escape");
  await expect(addPage.getByRole("note")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(addPage).toHaveCount(0);

  // The task editor from the Tasks page, and the person editor from the
  // People page, carry their own entries.
  await openCollection(page, "Tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const task = page.getByRole("dialog", { name: "Add task", exact: true });
  await control(task, "editor").click();
  await expect(
    task.getByRole("note", { name: "About this editor" }).getByRole("term"),
  ).toHaveText(["Drafts"]);
  await page.keyboard.press("Escape");
  await expect(task.getByRole("note")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(task).toHaveCount(0);

  await openCollection(page, "People");
  await page.getByRole("button", { name: "New person", exact: true }).click();
  const person = page.getByRole("dialog", { name: "Add person", exact: true });
  await control(person, "editor").click();
  await expect(
    person.getByRole("note", { name: "About this editor" }).getByRole("term"),
  ).toHaveText(["Accounts", "Fields", "Drafts"]);
});

import { expect, type Page } from "@playwright/test";

/**
 * Opens People from the rail, adds a person with an email, a field, and the
 * link to the signed-in user, checks the namecard, hides the field for this
 * device across a reload, edits the field, and filters by name.
 */
export async function exercisePeoplePage(page: Page) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "People", exact: true })
    .click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(
    page.getByRole("heading", { name: "People", level: 1 }),
  ).toBeVisible();
  // The page keeps the rail, with its own entry marked as the current one.
  await expect(
    page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "People", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "New person", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add person", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill("Mira Chen");
  await editor.getByLabel("Email", { exact: true }).fill("mira@example.test");
  await editor.getByLabel("This is me").check();
  await editor.getByRole("button", { name: "Add field", exact: true }).click();
  await editor.getByLabel("Field 1 name").fill("phone");
  await editor.getByLabel("Field 1 value").fill("+1 555 0100");
  await editor.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const card = page.getByRole("listitem", { name: "Mira Chen" });
  await expect(card.getByRole("heading")).toHaveText("Mira Chen (me)");
  await expect(
    card.getByRole("link", { name: "mira@example.test" }),
  ).toBeVisible();
  await expect(card.getByText("+1 555 0100")).toBeVisible();
  await expect(page.getByText("1 person loaded")).toBeVisible();

  // Hiding a field is a device preference that survives a reload.
  await page.getByText("Shown fields", { exact: true }).click();
  await page.getByRole("checkbox", { name: "phone" }).uncheck();
  await expect(card.getByText("+1 555 0100")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("listitem", { name: "Mira Chen" })).toBeVisible();
  await expect(page.getByText("+1 555 0100")).toHaveCount(0);
  await page.getByText("Shown fields", { exact: true }).click();
  await page.getByRole("checkbox", { name: "phone" }).check();
  await expect(page.getByText("+1 555 0100")).toBeVisible();

  // Editing keeps the link and changes the field.
  await page
    .getByRole("button", { name: "Edit Mira Chen", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit person", exact: true });
  await expect(edit.getByLabel("This is me")).toBeChecked();
  await edit.getByLabel("Field 1 value").fill("+1 555 0199");
  await edit.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByText("+1 555 0199")).toBeVisible();

  await page.getByLabel("Filter people by name").fill("nobody");
  await expect(page.getByText("No matching people")).toBeVisible();
  await page.getByLabel("Filter people by name").fill("");
  await expect(page.getByRole("listitem", { name: "Mira Chen" })).toBeVisible();
  return "Mira Chen";
}

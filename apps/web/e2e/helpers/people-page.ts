import { expect, type Page } from "@playwright/test";

/**
 * Opens People from the rail, adds a person with a nickname, an email and a
 * phone, a label, a field, and the link to the signed-in user, checks the
 * namecard, hides the field for this device across a reload, removes the
 * phone and edits the field, and filters by name.
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
  await editor.getByLabel("Nickname", { exact: true }).fill("Mira");
  await editor.getByLabel("This is me").check();
  await editor
    .getByRole("button", { name: "Add contact", exact: true })
    .click();
  await editor.getByLabel("Contact 1 value").fill("mira@example.test");
  await editor
    .getByRole("button", { name: "Add contact", exact: true })
    .click();
  await editor.getByLabel("Contact 2 kind").selectOption("phone");
  await editor.getByLabel("Contact 2 value").fill("+1 555 0100");
  // A label added from the editor is selected at once.
  await editor.getByText("Labels", { exact: true }).click();
  await editor.getByPlaceholder("New label").fill("family");
  await editor.getByRole("button", { name: "Add label", exact: true }).click();
  await expect(editor.getByRole("checkbox", { name: "family" })).toBeChecked();
  await editor.getByRole("button", { name: "Add field", exact: true }).click();
  await editor.getByLabel("Field 1 name").fill("diet");
  await editor.getByLabel("Field 1 value").fill("Vegetarian");
  await editor.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(editor).toHaveCount(0);
  // The card shows the nickname with the full name under it.
  const card = page.getByRole("listitem", { name: "Mira", exact: true });
  await expect(card.getByRole("heading")).toHaveText("Mira (me)");
  await expect(card.getByText("Mira Chen", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("link", { name: "mira@example.test" }),
  ).toBeVisible();
  await expect(card.getByRole("link", { name: "+1 555 0100" })).toHaveAttribute(
    "href",
    "tel:+1 555 0100",
  );
  await expect(
    card.getByRole("list", { name: "Labels" }).getByText("family"),
  ).toBeVisible();
  await expect(card.getByText("Vegetarian")).toBeVisible();
  await expect(page.getByText("1 person loaded")).toBeVisible();

  // Hiding a field is a device preference that survives a reload.
  await page.getByText("Shown fields", { exact: true }).click();
  await page.getByRole("checkbox", { name: "diet" }).uncheck();
  await expect(card.getByText("Vegetarian")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("listitem", { name: "Mira", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Vegetarian")).toHaveCount(0);
  await page.getByText("Shown fields", { exact: true }).click();
  await page.getByRole("checkbox", { name: "diet" }).check();
  await expect(page.getByText("Vegetarian")).toBeVisible();

  // Editing keeps the link, removes the phone, and changes the field.
  await page.getByRole("button", { name: "Edit Mira", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit person", exact: true });
  await expect(edit.getByLabel("This is me")).toBeChecked();
  await expect(edit.getByLabel("Nickname", { exact: true })).toHaveValue(
    "Mira",
  );
  await edit
    .getByRole("button", { name: "Remove contact 2", exact: true })
    .click();
  await edit.getByLabel("Field 1 value").fill("Vegetarian dishes");
  await edit.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByText("Vegetarian dishes")).toBeVisible();
  await expect(page.getByText("+1 555 0100")).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "mira@example.test" }),
  ).toBeVisible();

  await page.getByLabel("Filter people by name").fill("nobody");
  await expect(page.getByText("No matching people")).toBeVisible();
  await page.getByLabel("Filter people by name").fill("");
  await expect(
    page.getByRole("listitem", { name: "Mira", exact: true }),
  ).toBeVisible();
  return "Mira Chen";
}

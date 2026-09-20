import { expect, type Page } from "@playwright/test";

import {
  closeDrawer,
  openCollection,
  workspaceNavigation,
} from "./quiet-chrome";
import { chooseRowAction } from "./row-menu";

/** Chooses one of a quiet heading menu's choices. */
async function chooseFromHeadMenu(page: Page, control: RegExp, choice: string) {
  await page.getByRole("button", { name: control }).click();
  await page.getByRole("menuitemradio", { name: choice, exact: true }).click();
}

/** Presses one of the segmented layout control's choices. */
async function chooseLayout(page: Page, choice: "List" | "Namecards") {
  await page
    .getByRole("group", { name: "Layout", exact: true })
    .getByRole("button", { name: choice, exact: true })
    .click();
}

/**
 * Opens People from the rail, adds a person through the quick add row,
 * gives them a nickname, an email and a phone, a label, a field, and the
 * link to the signed-in user from the row menu, checks the row, switches
 * to namecards, filters by the label, opens the person's page from the
 * card and reads its details, returns by the up link, and filters by
 * name.
 */
export async function exercisePeoplePage(page: Page) {
  await openCollection(page, "People");
  await expect(page).toHaveURL(/\/people$/);
  await expect(
    page.getByRole("heading", { name: "People", level: 1 }),
  ).toBeVisible();
  // The page keeps the rail, with its own entry marked as the current one.
  await expect(
    (await workspaceNavigation(page)).getByRole("link", {
      name: "People",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await closeDrawer(page);

  // Quick add creates the person with the name and keeps the field open.
  await page.getByRole("button", { name: "Add a person", exact: true }).click();
  const field = page.getByRole("textbox", { name: "New person", exact: true });
  await field.fill("Mira Chen");
  await field.press("Enter");
  const row = page.getByRole("listitem", { name: "Mira Chen", exact: true });
  await expect(row).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await field.press("Escape");
  await expect(page.getByText("1 person loaded")).toBeAttached();

  // Edit from the row menu: nickname, the link to the signed-in user from
  // the Name field's lookup (the pick fills the name and adds the account's
  // email, both put back), contacts, a label added from the editor, and a
  // custom field.
  await chooseRowAction(page, row, "Edit");
  const editor = page.getByRole("dialog", { name: "Edit person", exact: true });
  await editor.getByLabel("Nickname", { exact: true }).fill("Mira");
  const name = editor.getByRole("combobox", { name: "Name", exact: true });
  await name.click();
  const accounts = editor.getByRole("listbox", { name: "Accounts" });
  await expect(accounts.getByRole("option")).toHaveCount(1);
  await accounts.getByRole("option", { name: / You$/ }).click();
  await expect(name).toHaveValue(/planner$/i);
  await expect(editor.locator(".person-link-mark")).toHaveText(/^You/);
  await expect(accounts).toHaveCount(0);
  await editor
    .getByRole("button", { name: "Remove contact 1", exact: true })
    .click();
  await name.fill("Mira Chen");
  await expect(accounts).toHaveCount(0);
  await editor
    .getByRole("button", { name: "Add contact", exact: true })
    .click();
  await editor.getByLabel("Contact 1 value").fill("mira@example.test");
  await editor.getByLabel("Contact 1 value").press("Enter");
  await expect(
    editor.getByRole("button", { name: "Email: mira@example.test" }),
  ).toBeFocused();
  await editor
    .getByRole("button", { name: "Add contact", exact: true })
    .click();
  await editor.getByLabel("Contact 2 kind").selectOption("phone");
  await editor.getByLabel("Contact 2 value").fill("+1 555 0100");
  await editor.getByLabel("Contact 2 value").press("Enter");
  await editor.getByRole("button", { name: "Labels", exact: true }).click();
  await editor.getByPlaceholder("New label").fill("family");
  await editor.getByRole("button", { name: "Add label", exact: true }).click();
  await expect(editor.getByRole("checkbox", { name: "family" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(
    editor.getByRole("button", { name: "Labels: family", exact: true }),
  ).toBeFocused();
  await editor.getByRole("button", { name: "Add field", exact: true }).click();
  await expect(editor.getByLabel("Field 1 name")).toBeFocused();
  await editor.getByLabel("Field 1 name").fill("diet");
  await editor.getByLabel("Field 1 value").fill("Vegetarian");
  await editor
    .getByRole("button", { name: "Save person", exact: true })
    .click();
  await expect(editor).toHaveCount(0);

  // The row shows the nickname over the full name as the link to the person.
  const mira = page.getByRole("listitem", { name: "Mira", exact: true });
  await expect(mira.getByRole("link", { name: "Open Mira" })).toBeVisible();
  await expect(mira.getByText("Mira Chen", { exact: true })).toBeAttached();

  // A second person, without a label, for the filter to leave out.
  await page.getByRole("button", { name: "Add a person", exact: true }).click();
  await field.fill("adam");
  await field.press("Enter");
  await expect(
    page.getByRole("listitem", { name: "adam", exact: true }),
  ).toBeVisible();
  await field.press("Escape");

  // Namecards show the contacts, the label, and the badge for the
  // signed-in user's own person at every width; the layout is kept on
  // this device.
  await chooseLayout(page, "Namecards");
  const cards = page.getByRole("list", { name: "People", exact: true });
  await expect(cards).toHaveClass(/person-grid/);
  const card = cards.getByRole("listitem", { name: "Mira", exact: true });
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
  await expect(card.getByText("This is me", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("list", { name: "People", exact: true }),
  ).toHaveClass(/person-grid/);

  // Filtering by the label from the menu leaves adam out; the label's chip
  // shows the choice, and Clear filters brings them back.
  await chooseFromHeadMenu(page, /^Filter/, "family");
  await expect(
    page.getByRole("listitem", { name: "adam", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("listitem", { name: "Mira", exact: true }),
  ).toBeVisible();
  const labelChips = page.getByRole("group", { name: "Labels", exact: true });
  await expect(
    labelChips.getByRole("button", { name: "family", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page
    .getByRole("menuitem", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page.getByRole("listitem", { name: "adam", exact: true }),
  ).toBeVisible();
  // The connection chips narrow the list the same way.
  const accountChips = page.getByRole("group", {
    name: "Account",
    exact: true,
  });
  await accountChips.getByRole("button", { name: "Friends" }).click();
  await expect(page.getByText("No matching people")).toBeVisible();
  await accountChips.getByRole("button", { name: "Everyone" }).click();
  await expect(
    page.getByRole("listitem", { name: "Mira", exact: true }),
  ).toBeVisible();

  // The card opens the person's page: the names, the badge, the details.
  await page
    .getByRole("listitem", { name: "Mira", exact: true })
    .getByRole("link", { name: "Open Mira" })
    .click();
  await expect(page).toHaveURL(/\/people\/[\da-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mira");
  // The full name reads under the title; the details list the nickname,
  // the email, and the field. Without a description there is no panel for
  // it, and the connection says this card is the signed-in user's own.
  await expect(page.getByText("Mira Chen", { exact: true })).toBeVisible();
  await expect(page.getByText("This is me", { exact: true })).toBeVisible();
  const overview = page.getByRole("tabpanel");
  await expect(overview.getByText("Nickname", { exact: true })).toBeVisible();
  await expect(
    overview.getByRole("link", { name: "mira@example.test" }),
  ).toBeVisible();
  await expect(overview.getByText("diet", { exact: true })).toBeVisible();
  await expect(overview.getByText("Vegetarian", { exact: true })).toBeVisible();
  await expect(
    overview.getByRole("region", { name: "Description" }),
  ).toHaveCount(0);
  await expect(
    overview.getByText("This is you", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Events", exact: true }).click();
  await expect(page.getByText("Not part of any event yet")).toBeVisible();

  // Back to the collection by the up link; the list layout is a choice again.
  await page.getByRole("link", { name: "All people", exact: true }).click();
  await expect(page).toHaveURL(/\/people$/);
  await chooseLayout(page, "List");
  await expect(
    page.getByRole("list", { name: "People", exact: true }),
  ).toHaveClass(/person-list/);

  // The name query asks the server.
  await page.getByLabel("Filter people by name").fill("nobody");
  await expect(page.getByText("No matching people")).toBeVisible();
  await page.getByLabel("Filter people by name").fill("");
  await expect(
    page.getByRole("listitem", { name: "Mira", exact: true }),
  ).toBeVisible();
  return "Mira Chen";
}

import { expect, test } from "@playwright/test";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("offers Move to space offline, where the sample's one space leaves nowhere to go", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await page
    .getByRole("button", { name: "Actions for Autumn gathering" })
    .click();
  await page.getByRole("menuitem", { name: "Move to space..." }).click();
  const dialog = page.getByRole("dialog", { name: "Move to space" });
  const spaces = dialog.getByRole("radiogroup", { name: "Spaces" });
  await expect(spaces.getByRole("radio")).toHaveCount(1);
  await expect(spaces.getByRole("radio")).toBeDisabled();
  await expect(spaces).toContainText("Here now");
  await expect(dialog).toContainText(
    "There is no other space where you can add it.",
  );
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  // A Viewer is offered no move.
  await page.getByLabel("Preview role").selectOption("viewer");
  await page
    .getByRole("button", { name: "Actions for Autumn gathering" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Move to space..." }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

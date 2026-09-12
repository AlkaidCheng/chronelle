import { expect, test } from "@playwright/test";
import { exerciseWorkspaceCommands } from "../../e2e/helpers/workspace-commands";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("protects offline Task editor focus and retains filters through commands", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseWorkspaceCommands(page, testInfo);
});

test("offers the same navigation to Viewers without editing commands", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByLabel("Preview role").selectOption("viewer");
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Commands", exact: true });
  await expect(dialog.getByRole("listbox").getByRole("option")).toHaveCount(3);
  await expect(
    dialog.getByRole("option", { name: /create|edit|add/i }),
  ).toHaveCount(0);
  await dialog.getByRole("option", { name: /Events/ }).click();
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await expect(
    page.getByRole("button", { name: "Edit event", exact: true }),
  ).toHaveCount(0);
});

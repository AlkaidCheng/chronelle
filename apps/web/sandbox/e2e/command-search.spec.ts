import { expect, test } from "@playwright/test";
import { exerciseCommandSearch } from "../../e2e/helpers/command-search";
import { openCommands } from "../../e2e/helpers/context-commands";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("finds sample records with the shared Commands UI while offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await exerciseCommandSearch(page, testInfo);
  await page.getByLabel("Preview role").selectOption("viewer");
  const dialog = await openCommands(page);
  await dialog
    .getByRole("combobox", {
      name: "Search records and commands",
    })
    .fill("garden");
  await expect(
    dialog.getByRole("option", { name: /Confirm the garden venue/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: /Edit event|Add component/ }),
  ).toHaveCount(0);
});

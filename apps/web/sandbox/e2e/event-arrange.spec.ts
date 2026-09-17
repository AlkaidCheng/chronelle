import { expect, test } from "@playwright/test";
import { exerciseEventArrange } from "../../e2e/helpers/event-arrange";
import { openCommands } from "../../e2e/helpers/context-commands";
import { choosePageOption, pageOptions } from "../../e2e/helpers/quiet-chrome";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("keeps offline arrangement local and resets it when preview access changes", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await exerciseEventArrange(page, testInfo);
  await choosePageOption(page, "Arrange layout");
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("button", {
      name: /Arrange layout|Done arranging|^Move |^Drag /,
    }),
  ).toHaveCount(0);
  const commands = await openCommands(page);
  await expect(commands.getByRole("option", { name: /arrang/i })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Preview role").selectOption("owner");
  await expect(pageOptions(page)).toBeVisible();
  await expect(
    page.getByRole("group", { name: /layout controls/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

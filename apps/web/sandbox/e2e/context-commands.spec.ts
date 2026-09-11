import { expect, test } from "@playwright/test";
import {
  exerciseContextCommands,
  openCommands,
} from "../../e2e/helpers/context-commands";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("opens context controls offline and clears them on role changes", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  const eventUrl = page.url();
  await exerciseContextCommands(page, testInfo, { canShare: false });
  await page.goto(eventUrl);
  await page.getByLabel("Preview role").selectOption("viewer");
  const commands = await openCommands(page);
  await expect(
    commands.getByRole("group", { name: "Event actions" }).getByRole("option"),
  ).toHaveCount(1);
  await expect(
    commands.getByRole("option", {
      name: /Edit event|Share event|Add page|Add component/,
    }),
  ).toHaveCount(0);
  await commands.getByRole("option", { name: /Event history/ }).click();
  await expect(
    page.getByRole("button", { name: "Close history" }),
  ).toBeVisible();
});

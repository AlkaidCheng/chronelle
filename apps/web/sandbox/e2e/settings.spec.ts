import { expect, type Page, test } from "@playwright/test";
import { openEventView } from "../../e2e/helpers/event-view";
import { accountBlock } from "../../e2e/helpers/quiet-chrome";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

/** The app's address in the sandbox: the path and query in the fragment. */
const address = (page: Page) => new URL(page.url()).hash.slice(1);

test("opens Settings over the page by its address in the fragment", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await openEventView(page, "To-dos");
  const eventAddress = address(page);
  expect(eventAddress).toMatch(/\?view=todos$/u);

  // From the account menu: an entry of its own over the event's To-dos.
  await accountBlock(page).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("menu", { name: "Account", exact: true })
    .getByRole("menuitem", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect
    .poll(() => address(page))
    .toBe(`${eventAddress}&settings=general`);
  await settings
    .getByRole("button", { name: "Language & time", exact: true })
    .click();
  await expect
    .poll(() => address(page))
    .toBe(`${eventAddress}&settings=language`);
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settings).toHaveCount(0);
  await expect.poll(() => address(page)).toBe(eventAddress);
  await expect(
    page.getByRole("tab", { name: "To-dos", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(accountBlock(page)).toBeFocused();

  // Back closes it as well.
  await accountBlock(page).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(settings).toBeVisible();
  await page.goBack();
  await expect(settings).toHaveCount(0);
  await expect.poll(() => address(page)).toBe(eventAddress);

  // The old addresses open it over Events.
  await page.evaluate(() => {
    window.location.hash = "/settings/appearance";
  });
  await expect.poll(() => address(page)).toBe("/events?settings=appearance");
  await expect(
    settings.getByRole("heading", { level: 2, name: "Appearance" }),
  ).toBeVisible();
});

import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { moreControl, openMoreMenu } from "./helpers/quiet-chrome";

async function signIn(page: Page, name: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(`install-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
}

/** The browser's deferred prompt, raised the way Chrome raises it. */
async function raiseInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    const record = { prompted: 0 };
    Object.assign(event, {
      prompt: () => {
        record.prompted += 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    Object.assign(window, { installPromptRecord: record });
    window.dispatchEvent(event);
  });
}

const promptedCount = (page: Page) =>
  page.evaluate(
    () =>
      (window as { installPromptRecord?: { prompted: number } })
        .installPromptRecord?.prompted ?? 0,
  );

test("raises the browser's install prompt from More and from Settings @webkit-desktop", async ({
  page,
}) => {
  await signIn(page, "Installer");
  let more = await openMoreMenu(page);
  // Nothing to offer until the browser raises its prompt.
  await expect(
    more.getByRole("menuitem", { name: "Install app", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(more).toHaveCount(0);
  await raiseInstallPrompt(page);
  more = await openMoreMenu(page);
  await more
    .getByRole("menuitem", { name: "Install app", exact: true })
    .click();
  await expect.poll(() => promptedCount(page)).toBe(1);
  // Accepted: the control is spent.
  more = await openMoreMenu(page);
  await expect(
    more.getByRole("menuitem", { name: "Install app", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/settings/appearance");
  const row = page.getByRole("heading", { name: "Install app", exact: true });
  await expect(row).toBeVisible();
  await expect(
    page.getByText("Install from your browser's menu."),
  ).toBeVisible();
  await raiseInstallPrompt(page);
  await expect(
    page.getByText(
      "Runs from your home screen like an app; nothing else changes.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Install app", exact: true }).click();
  await expect.poll(() => promptedCount(page)).toBe(1);
});

test.describe("on Safari for iPhone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("shows the Add to Home Screen steps instead of a prompt @webkit-desktop", async ({
    page,
  }) => {
    await signIn(page, "Installer");
    await (
      await openMoreMenu(page)
    )
      .getByRole("menuitem", { name: "Install app", exact: true })
      .click();
    const steps = page.getByRole("dialog", { name: "Install LivTales" });
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("listitem")).toHaveText([
      "Tap Share in Safari's toolbar.",
      "Choose Add to Home Screen.",
    ]);
    await steps.getByRole("button", { name: "Done", exact: true }).click();
    await expect(steps).toHaveCount(0);
    await expect(moreControl(page)).toBeFocused();
  });
});

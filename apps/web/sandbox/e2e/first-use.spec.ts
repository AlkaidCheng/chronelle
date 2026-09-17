import { expect, test } from "@playwright/test";
import {
  activateWithKeyboard,
  createFirstPlan,
} from "../../e2e/helpers/first-use";
import { sandboxStorageKey } from "../storage-key";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("starts with an empty offline workspace and composes only selected components", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ objects: [], relations: [], layouts: [] }),
    );
  }, sandboxStorageKey);
  if (testInfo.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 568 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await createFirstPlan(page, testInfo);
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  // Trash sits under More; the menu's first entry takes focus when it opens.
  await activateWithKeyboard(page, page.locator(".more-trigger"));
  await expect(
    page.getByRole("menuitem", { name: "Trash", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "No recoverable objects" }),
  ).toBeVisible();
  await activateWithKeyboard(
    page,
    navigation.getByRole("link", { name: "Events", exact: true }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("link", { name: /A first gathering/ }),
  );
  await expect(
    page.getByRole("row").filter({ hasText: "Invite a friend" }),
  ).toBeVisible();
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Add page", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add component", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

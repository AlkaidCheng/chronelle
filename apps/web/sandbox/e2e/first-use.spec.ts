import { expect, test } from "@playwright/test";
import {
  activateWithKeyboard,
  createFirstPlan,
  openTrashWithKeyboard,
} from "../../e2e/helpers/first-use";
import { isPhone, menuControl } from "../../e2e/helpers/quiet-chrome";
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
  // Trash sits under More, reached with the keyboard.
  await openTrashWithKeyboard(page);
  await expect(
    page.getByRole("heading", { name: "No recoverable objects" }),
  ).toBeVisible();
  // Events from the sidebar: the phone's drawer opens from its menu control.
  if (isPhone(page)) await activateWithKeyboard(page, menuControl(page));
  await activateWithKeyboard(
    page,
    page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Events", exact: true }),
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

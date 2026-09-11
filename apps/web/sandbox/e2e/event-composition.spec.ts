import { expect, test } from "@playwright/test";
import { dragComponent } from "../../e2e/helpers/drag-component";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("composes offline with search, drag or touch controls, and persistent cross-page moves", async ({
  page,
  context,
  isMobile,
}, testInfo) => {
  await context.setOffline(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  for (const name of ["Day", "Work"]) {
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await page.getByLabel("Page name").fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add page", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  for (const command of ["todos", "calendar", "files"]) {
    if (isMobile)
      await page
        .getByRole("button", { name: "Add component", exact: true })
        .click();
    else {
      await page
        .getByRole("navigation", { name: "Pages", exact: true })
        .getByRole("button", { name: "Work", exact: true })
        .focus();
      await page.keyboard.press("/");
    }
    await expect(
      page.getByRole("searchbox", { name: "Find a component" }),
    ).toBeFocused();
    await page
      .getByRole("searchbox", { name: "Find a component" })
      .fill(`/${command}`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Add / })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  const blocks = page.locator(".event-component-block");
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Arrange layout", exact: true })
    .click();
  if (isMobile)
    await page
      .getByRole("button", { name: "Move Calendar up", exact: true })
      .click();
  else
    await dragComponent(
      page,
      page.getByRole("button", { name: "Drag Calendar", exact: true }),
      blocks.first(),
    );
  await expect(blocks.first()).toHaveAttribute(
    "aria-label",
    "Calendar component 1",
  );
  await expect(
    page.getByRole("button", { name: "Move Calendar down", exact: true }),
  ).toBeEnabled();
  if (!isMobile) {
    await page
      .getByRole("button", { name: "Move Calendar down", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(blocks.nth(1)).toHaveAttribute(
      "aria-label",
      "Calendar component 2",
    );
    await expect(
      page.getByRole("button", { name: "Move Calendar down", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Move Calendar up", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(blocks.first()).toHaveAttribute(
      "aria-label",
      "Calendar component 1",
    );
    await expect(
      page.getByRole("button", { name: "Drag Calendar", exact: true }),
    ).toBeFocused();
  }
  if (isMobile)
    await page
      .getByRole("combobox", { name: "Move Calendar to page", exact: true })
      .selectOption({ label: "Day" });
  else
    await dragComponent(
      page,
      page.getByRole("button", { name: "Drag Calendar", exact: true }),
      page
        .getByRole("navigation", { name: "Pages", exact: true })
        .getByRole("button", { name: "Day", exact: true }),
    );
  await expect(
    page.getByRole("heading", { name: "Day", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome and coffee", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move page later", exact: true })
    .click();
  const tabs = page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button");
  await expect(tabs).toHaveText(["Work", "Day"]);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await expect(tabs).toHaveText(["Work", "Day"]);
  await expect(
    page.getByRole("heading", { name: "Day", exact: true }),
  ).toBeVisible();
  await expect(blocks).toHaveCount(1);
  await tabs.filter({ hasText: "Work" }).click();
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first()).toHaveAttribute(
    "aria-label",
    "To-dos component 1",
  );
  await expect(
    page.getByText("Confirm the garden venue", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("composition-controls.png"),
    fullPage: true,
  });
  await page.getByLabel("Preview role").selectOption("viewer");
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Drag / })).toHaveCount(0);
  expect(errors).toEqual([]);
});

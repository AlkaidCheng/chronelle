import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { openSearchPage } from "./helpers/quiet-chrome";
import { openTaskEditor } from "./helpers/task-add";
import { openEventView } from "./helpers/event-view";

test("creates and retrieves one canonical Event at responsive widths", async ({
  page,
}, testInfo) => {
  const projectLabel = testInfo.project.name.replace("chromium-", "");
  const eventName = `${projectLabel} launch plan`;

  await page.goto("/sign-in/development");
  await page.getByLabel("Name").fill(`${projectLabel} planner`);
  await page
    .getByLabel("Email")
    .fill(`${projectLabel}-planner-${randomUUID()}@example.test`);
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await continueButton.click();
  await expect(page).toHaveURL(/\/events$/u);

  await page.getByRole("button", { name: "New event" }).click();
  await page.getByLabel("Event name").fill(eventName);
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/u);
  await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
  const eventUrl = page.url();

  const overviewTab = page.getByRole("tab", { name: "Overview" });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "To-dos" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await openTaskEditor(page);
  await page.getByLabel("Task", { exact: true }).fill("Confirm venue");
  const creation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/resources") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  expect((await creation).status()).toBe(201);
  await expect(page.getByText("Confirm venue", { exact: true })).toBeVisible();
  await page.reload();
  await openEventView(page, "To-dos");
  await expect(page.getByText("Confirm venue", { exact: true })).toBeVisible();
  await openEventView(page, "Sharing");
  await expect(
    page.getByRole("heading", { name: "People with access", exact: true }),
  ).toBeVisible();
  // The owner heads the list; nobody else has access yet.
  const access = page.locator(".share-list article");
  await expect(access).toHaveCount(1);
  await expect(access.first()).toContainText("(you)");
  await expect(access.first()).toContainText("Owner");

  await openSearchPage(page);
  await page.getByLabel("Keywords").fill("launch plan");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const result = page.getByRole("link", { name: new RegExp(eventName, "u") });
  await expect(result).toHaveAttribute("href", new URL(eventUrl).pathname);

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await result.click();
  await expect(page).toHaveURL(eventUrl);
  await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
});

test("loads additional search results with keyboard navigation and resets filters", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `search-pages-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Search planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  for (let index = 0; index < 23; index += 1) {
    const created = await request.post("/api/events", {
      headers,
      data: { displayName: `Searchable plan ${index}` },
    });
    expect(created.status()).toBe(201);
  }
  await page.goto("/sign-in/development");
  await page.getByLabel("Name").fill("Search planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await openSearchPage(page);
  await page.getByLabel("Keywords").fill("Searchable");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("20 loaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more results" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("23 loaded", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more results" }),
  ).toHaveCount(0);
  const links = page.getByRole("link", { name: /Searchable plan/u });
  await expect(links).toHaveCount(23);
  const hrefs = await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href")),
  );
  expect(new Set(hrefs).size).toBe(23);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("search-pages.png"),
    fullPage: true,
  });
  await page.getByLabel("Type").selectOption("task");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No accessible objects found" }),
  ).toBeVisible();
  await expect(links).toHaveCount(0);
  expect(errors).toEqual([]);
});

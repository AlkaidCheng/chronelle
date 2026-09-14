import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("organizes events and keeps navigation usable across reloads and screen sizes", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `experience-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Preview planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const plans = [
    { displayName: "Autumn gathering", startsAt: "2099-10-15T17:00:00.000Z" },
    { displayName: "A weekend worth planning", startsAt: null },
    { displayName: "Summer celebration", startsAt: "2000-07-01T12:00:00.000Z" },
    {
      displayName:
        "A thoughtful plan with a very long name for everyone coming together to celebrate a meaningful milestone",
      startsAt: "2099-11-01T12:00:00.000Z",
    },
  ];
  for (const plan of plans) {
    const response = await request.post("/api/events", {
      headers,
      data: { ...plan, timezone: "UTC" },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto("/sign-in");
  await page.screenshot({
    path: testInfo.outputPath("sign-in.png"),
    fullPage: true,
  });
  await page.getByLabel("Name", { exact: true }).fill("Preview planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
    "4 events loaded",
  );
  await expect(
    page.getByRole("link", { name: "Events", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: testInfo.outputPath("events-grid.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "List view" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Upcoming & ongoing" }).click();
  await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
    "2 events loaded",
  );
  await page.getByLabel("Filter events by name").fill("missing event");
  await expect(
    page.getByRole("heading", { name: "No matching events" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("status", { name: "Event count" })).toHaveText(
    "4 events loaded",
  );
  await page.getByLabel("Sort events").selectOption("name");
  await page.getByRole("button", { name: "New event" }).click();
  await expect(page.getByLabel("Event name")).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "New event" })).toBeFocused();
  await page.getByRole("link", { name: /Autumn gathering/u }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/u);
  await page.getByRole("button", { name: "Browse event data" }).click();
  await expect(
    page.getByRole("heading", { name: "Your event, connected." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Autumn gathering", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("event-overview.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\?view=calendar$/u);
  const viewRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/events/")) viewRequests.push(pathname);
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Nothing scheduled" }),
  ).toBeVisible();
  expect(viewRequests.some((path) => path.endsWith("/calendar"))).toBe(true);
  expect(viewRequests.some((path) => path.endsWith("/detail"))).toBe(false);
  await page.getByRole("tab", { name: "To-dos" }).click();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Calendar" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unsaved event draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved event draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(
    page.getByRole("heading", { name: "Your event, connected." }),
  ).toBeVisible();
  expect(viewRequests.some((path) => path.endsWith("/detail"))).toBe(true);
  await expect(
    page.getByRole("dialog", { name: "Edit event", exact: true }),
  ).toHaveCount(0);

  if (testInfo.project.name !== "chromium-mobile") {
    const account = page.getByRole("button", { name: "Preview planner" });
    await expect(account).toHaveAttribute("aria-expanded", "false");
    await account.click();
    const signOut = page.getByRole("button", { name: "Sign out", exact: true });
    await expect(signOut).toBeVisible();
    await signOut.focus();
    await page.keyboard.press("Escape");
    await expect(signOut).toHaveCount(0);
    await expect(account).toBeFocused();
    await expect(account).toHaveAttribute("aria-expanded", "false");
  }
  if (testInfo.project.name === "chromium-mobile") {
    await page.getByLabel("Event view", { exact: true }).selectOption("files");
    await expect(page.getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "More", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).not.toBeVisible();
  }
  if (testInfo.project.name === "chromium-mobile") {
    await page.getByRole("button", { name: "More", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Preview planner" }).click();
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  await page.goto("/events");
  await expect(page).toHaveURL(/\/sign-in$/u);
  expect(errors).toEqual([]);
});

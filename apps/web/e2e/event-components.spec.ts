import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signOutFromMenu } from "./helpers/quiet-chrome";

test("composes planning and private-file components with canonical updates and viewer access", async ({
  page,
  request,
}, testInfo) => {
  const email = `components-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: {
      displayName: "Summer vacation",
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
    },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const scheduled = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: {
        objectType: "event",
        displayName: "Mountain stay",
        startsOn: "2030-07-04",
        endsOn: "2030-07-06",
      },
    },
  });
  expect(scheduled.status()).toBe(201);
  const { resource: activity } = await scheduled.json();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto(`/events/${event.id}`);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByLabel("Page name").fill("Travel");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add page", exact: true })
    .click();
  for (const label of [
    "Calendar",
    "Timeline",
    "Expenses",
    "Reminders",
    "Files",
    "To-dos",
  ]) {
    await page
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add a component" });
    await dialog.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
    await dialog
      .getByRole("button", { name: `Add ${label}`, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }
  const calendar = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Calendar", exact: true }),
  });
  await calendar.getByRole("button", { name: "Edit", exact: true }).click();
  const inspector = page.getByRole("dialog", { name: "Edit schedule item" });
  await inspector
    .getByLabel("Name", { exact: true })
    .fill("Mountain cabin stay");
  await inspector
    .getByRole("button", { name: "Save event", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mountain cabin stay", exact: true }),
  ).toHaveCount(2);
  const expense = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Expenses", exact: true }),
  });
  await expense
    .getByRole("button", { name: "Add expense", exact: true })
    .click();
  const expenseEditor = page.getByRole("dialog", {
    name: "Add expense",
    exact: true,
  });
  await expenseEditor
    .getByLabel("Expense", { exact: true })
    .fill("Cabin deposit");
  await expenseEditor.getByLabel("Amount", { exact: true }).fill("120.25");
  expect(
    await expenseEditor
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.checkValidity()),
  ).toBe(true);
  const expenseCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}/resources`) &&
      response.request().method() === "POST",
  );
  await expenseEditor
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  const expenseResponse = await expenseCreated;
  expect(expenseResponse.status()).toBe(201);
  expect((await expenseResponse.json()).resource).toMatchObject({
    objectType: "expense",
    displayName: "Cabin deposit",
    amount: "120.2500",
  });
  await expect(expenseEditor).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Cabin deposit", exact: true }),
  ).toHaveCount(2);
  const reminder = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Reminders", exact: true }),
  });
  await reminder
    .getByRole("button", { name: "Add a reminder to the list", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add reminder with details", exact: true })
    .click();
  const reminderDialog = page.getByRole("dialog", {
    name: "Add reminder",
    exact: true,
  });
  await reminderDialog
    .getByLabel("Reminder", { exact: true })
    .fill("Confirm arrival time");
  await reminderDialog
    .getByLabel("Reminder time", { exact: true })
    .fill("2030-07-03T10:00");
  await reminderDialog
    .getByRole("button", { name: "Record reminder", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confirm arrival time", exact: true }),
  ).toHaveCount(2);
  const files = page.locator(".documents-panel");
  const showFilesOf = async (label: string) => {
    await files.getByRole("button", { name: /^Attached to: / }).click();
    await files.getByRole("menuitemradio", { name: label }).click();
  };
  await showFilesOf("Expense: Cabin deposit");
  // Choosing a file attaches it; the row says so until the upload settles.
  await files.getByLabel("Choose a private file").setInputFiles({
    name: "receipt.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Private cabin receipt"),
  });
  await expect(files.getByText("receipt.txt", { exact: true })).toBeVisible();
  await expect(
    files.getByRole("button", { name: "Attach a file", exact: true }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await files
    .getByRole("button", { name: "Download receipt.txt", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toBe("receipt.txt");
  const canonical = await request.get(`/api/events/${activity.id}`, {
    headers,
  });
  expect(await canonical.json()).toMatchObject({
    id: activity.id,
    displayName: "Mountain cabin stay",
    version: 2,
    startsOn: "2030-07-04",
    endsOn: "2030-07-06",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Mountain cabin stay", exact: true }),
  ).toHaveCount(2);
  await showFilesOf("Expense: Cabin deposit");
  await expect(files.getByText("receipt.txt", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("composed-planning.png"),
    fullPage: true,
  });

  const viewerEmail = `viewer-${randomUUID()}@example.test`;
  const viewerSignIn = await request.post("/api/auth/development/sign-in", {
    data: { email: viewerEmail, displayName: "Viewer" },
  });
  expect(viewerSignIn.status()).toBe(200);
  const viewer = await viewerSignIn.json();
  expect(
    (
      await request.post("/api/shares", {
        headers,
        data: {
          resourceId: event.id,
          principalEmail: viewerEmail,
          role: "viewer",
        },
      })
    ).status(),
  ).toBe(201);
  // The browser session is the cookie, so the viewer signs in through the
  // page; the tab then acts in the shared workspace, its home staying the
  // viewer's own.
  const pageUrl = page.url();
  await signOutFromMenu(page);
  await expect(page).toHaveURL(/\/sign-in$/u);
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Viewer");
  await page.getByLabel("Email").fill(viewerEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.evaluate(
    ({ workspaceId, homeWorkspaceId }) => {
      sessionStorage.setItem(
        "chronelle.session",
        JSON.stringify({ workspaceId, homeWorkspaceId }),
      );
    },
    {
      workspaceId: session.workspace.id,
      homeWorkspaceId: viewer.workspace.id,
    },
  );
  await page.goto(pageUrl);
  await expect(page.getByText("Viewer access", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add component", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await showFilesOf("Expense: Cabin deposit");
  await expect(files.getByText("receipt.txt", { exact: true })).toBeVisible();
  await expect(files.getByLabel("Choose a private file")).toHaveCount(0);
  await expect(files.getByText("Attach a file")).toHaveCount(0);
});

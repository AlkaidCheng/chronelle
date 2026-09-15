import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { exerciseCommandSearch } from "./helpers/command-search";
import { openCommands } from "./helpers/context-commands";
import { openWorkspaceSettings } from "./helpers/workspace-utilities";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
}

test("finds canonical events and tasks through Commands without losing a dismissed draft", async ({
  page,
  request,
}, testInfo) => {
  const email = `command-search-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.ok()).toBe(true);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Autumn gathering" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const task = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: { objectType: "task", displayName: "Confirm the garden venue" },
    },
  });
  expect(task.status()).toBe(201);
  await signIn(page, email);
  await exerciseCommandSearch(page, testInfo);
  expect(
    await (await request.get(`/api/events/${event.id}`, { headers })).json(),
  ).toEqual(event);
});

test("limits the palette to eight records and opens full Search for remaining results", async ({
  page,
  request,
}, testInfo) => {
  const email = `bounded-search-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(identity.ok()).toBe(true);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  for (let index = 0; index < 10; index++) {
    const created = await request.post("/api/events", {
      headers,
      data: { displayName: `Findable gathering ${index}` },
    });
    expect(created.status()).toBe(201);
  }
  await signIn(page, email);
  const dialog = await openCommands(page);
  const searched = page.waitForResponse((response) =>
    response.url().includes("/api/search?"),
  );
  await dialog.getByRole("combobox").fill("findable");
  expect(new URL((await searched).url()).searchParams.get("limit")).toBe("8");
  await expect(
    dialog.getByRole("group", { name: "Records" }).getByRole("option"),
  ).toHaveCount(8);
  await expect(dialog.getByText(/Showing eight records/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  const input = dialog.getByRole("combobox");
  const records = dialog
    .getByRole("group", { name: "Records" })
    .getByRole("option");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await input.press("ArrowUp");
    await expect(records.last()).toHaveAttribute("aria-selected", "true");
    await expect(records.last()).toBeInViewport({ ratio: 1 });
    await expect(input).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath(`command-search-bounded-${colorScheme}.png`),
    });
    await input.press("ArrowDown");
    await expect(records.first()).toHaveAttribute("aria-selected", "true");
    await expect(records.first()).toBeInViewport({ ratio: 1 });
    await expect(input).toBeInViewport({ ratio: 1 });
  }
  await dialog.getByRole("button", { name: "Open full Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByLabel("Keywords").fill("findable");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("10 loaded", { exact: true })).toBeVisible();
});

test("filters workspace and private records and rechecks revoked access", async ({
  page,
  request,
}) => {
  const email = `viewer-search-${randomUUID()}@example.test`;
  const viewerResponse = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Viewer" },
  });
  expect(viewerResponse.ok()).toBe(true);
  const ownerResponse = await request.post("/api/auth/development/sign-in", {
    data: {
      email: `owner-search-${randomUUID()}@example.test`,
      displayName: "Owner",
    },
  });
  expect(ownerResponse.ok()).toBe(true);
  const owner = await ownerResponse.json();
  const headers = { authorization: `Bearer ${owner.accessToken}` };
  const create = async (displayName: string) => {
    const response = await request.post("/api/events", {
      headers,
      data: { displayName },
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const event = await create("Shared gathering");
  await create("Private gathering");
  for (const isPrivate of [false, true]) {
    const response = await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: {
        commandId: randomUUID(),
        resource: {
          objectType: "task",
          displayName: isPrivate
            ? "Private gathering budget"
            : "Shared gathering task",
        },
      },
    });
    expect(response.status()).toBe(201);
    if (isPrivate) {
      const { resource } = await response.json();
      expect(
        (
          await request.patch(`/api/objects/${resource.id}/permission-scope`, {
            headers,
            data: {
              expectedVersion: resource.version,
              permissionScopeId: resource.id,
            },
          })
        ).ok(),
      ).toBe(true);
    }
  }
  const shared = await request.post("/api/shares", {
    headers,
    data: { resourceId: event.id, principalEmail: email, role: "viewer" },
  });
  expect(shared.status()).toBe(201);
  const grant = await shared.json();
  await signIn(page, email);
  const dialog = await openCommands(page);
  const input = dialog.getByRole("combobox");
  await input.fill("gathering");
  await expect(
    dialog.getByText("No accessible records found. Try another phrase."),
  ).toBeVisible();
  await input.press("Escape");
  const settings = await openWorkspaceSettings(page);
  await settings
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption(owner.workspace.id);
  await expect(settings).toHaveCount(0);
  await openCommands(page);
  await input.fill("gathering");
  await expect(
    dialog.getByRole("group", { name: "Records" }).getByRole("option"),
  ).toHaveCount(2);
  await expect(dialog.getByRole("option", { name: /Private/ })).toHaveCount(0);
  expect(
    (await request.delete(`/api/shares/${grant.id}`, { headers })).ok(),
  ).toBe(true);
  const denied = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/events/${event.id}`) &&
      response.status() === 404,
  );
  await dialog.getByRole("option", { name: /Shared gathering event/ }).click();
  await denied;
  await expect(page.getByRole("alert").first()).toBeVisible();
  await openCommands(page);
  const searchDenied = page.waitForResponse(
    (response) =>
      response.url().includes("/api/search?") && response.status() === 404,
  );
  await input.fill("gathering");
  await searchDenied;
  await expect(
    dialog.getByText(
      "Records could not be loaded. Navigation and event tools still work.",
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Records" })).toHaveCount(0);
});

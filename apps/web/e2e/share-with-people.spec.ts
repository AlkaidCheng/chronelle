import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("shares an event with the people the space knows", async ({
  page,
  request,
}) => {
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const readerEmail = `reader-${randomUUID()}@example.test`;
  const owner = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: ownerEmail, displayName: "Planner" },
    })
  ).json();
  const reader = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: readerEmail, displayName: "Reader" },
    })
  ).json();
  const headers = { authorization: `Bearer ${owner.accessToken}` };
  const readerHeaders = { authorization: `Bearer ${reader.accessToken}` };
  const event = await (
    await request.post("/api/events", {
      headers,
      data: { displayName: "Reading circle" },
    })
  ).json();
  // One person reaches an account through an email contact; one reaches
  // none.
  for (const data of [
    {
      displayName: "Reader Person",
      contacts: [{ kind: "email", value: readerEmail.toUpperCase() }],
    },
    { displayName: "No Account" },
  ])
    expect(
      (await request.post("/api/persons", { headers, data })).status(),
    ).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("link", { name: /Reading circle/ }).click();
  await page.getByRole("button", { name: "Share event", exact: true }).click();
  // Both cards are offered among the other people: the one with an email
  // is invited at it once ticked (the share waits on the request), the one
  // without gets a link the sharer hands on.
  const others = page.getByRole("list", { name: "Others in People" });
  await expect(others.getByRole("checkbox")).toHaveCount(2);
  await expect(others.getByText(new RegExp(readerEmail, "i"))).toBeVisible();
  await expect(
    others.getByText("No email; you send them the link"),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Friends" })).toHaveCount(0);
  const shareButton = page.getByRole("button", { name: /^Share with/ });
  await expect(shareButton).toBeDisabled();
  await others.getByRole("checkbox", { name: /Reader Person/ }).check();
  await expect(shareButton).toHaveText("Share with 1 person");
  await shareButton.click();
  await expect(
    others.getByText("Invitation sent; access follows when they join"),
  ).toBeVisible();
  const access = page.locator(".share-list");
  await expect(
    access.getByText("Reader Person", { exact: true }),
  ).toBeVisible();
  await expect(access.getByText(/Access follows when they join/)).toBeVisible();
  await expect(
    others.getByRole("checkbox", { name: /Reader Person/ }),
  ).not.toBeChecked();
  await expect(
    others.getByText("Invited; access follows when they join"),
  ).toBeVisible();
  const shares = await (
    await request.get(`/api/objects/${event.id}/shares`, { headers })
  ).json();
  expect(shares.items).toEqual([]);
  expect(shares.pending).toMatchObject([
    { role: "viewer", kind: "connection", email: readerEmail },
  ]);

  // The reader accepts the request: the share becomes a grant, and the
  // Sharing view shows it.
  const requests = await (
    await request.get("/api/friends", { headers: readerHeaders })
  ).json();
  expect(requests.incoming).toHaveLength(1);
  expect(
    (
      await request.post(
        `/api/friends/requests/${requests.incoming[0].id}/accept`,
        { headers: readerHeaders },
      )
    ).status(),
  ).toBe(200);
  // The view is in the URL, so the reload lands on Sharing again.
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Sharing", selected: true }),
  ).toBeVisible();
  await expect(access.getByText("Reader", { exact: true })).toBeVisible();
  await expect(access.getByText(/Access follows when they join/)).toHaveCount(
    0,
  );
  const grants = await (
    await request.get(`/api/objects/${event.id}/shares`, { headers })
  ).json();
  expect(grants.items).toMatchObject([
    { principal: { id: reader.user.id, email: readerEmail }, role: "viewer" },
  ]);
  expect(grants.pending).toEqual([]);
  // The reader, now a friend, is offered under Friends with the role held.
  const friends = page.getByRole("list", { name: "Friends" });
  await expect(
    friends.getByRole("checkbox", { name: /Reader Person/ }),
  ).toBeVisible();
  await expect(friends.getByText(/already Viewer/)).toBeVisible();
  expect(errors).toEqual([]);
});

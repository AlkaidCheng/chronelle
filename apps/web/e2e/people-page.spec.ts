import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { exercisePeoplePage } from "./helpers/people-page";

test("keeps people as namecards with chosen fields", async ({
  page,
  request,
}) => {
  const email = `people-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const session = await signedIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  const name = await exercisePeoplePage(page);
  const listed = await (await request.get("/api/persons", { headers })).json();
  expect(listed.items).toMatchObject([
    {
      displayName: name,
      email: "mira@example.test",
      userId: session.user.id,
      customProperties: { phone: "+1 555 0199" },
      version: 2,
    },
  ]);
  expect(errors).toEqual([]);
});

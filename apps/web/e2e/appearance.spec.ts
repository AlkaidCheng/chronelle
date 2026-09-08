import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exerciseAppearance } from "./helpers/appearance";

for (const appearance of ["light", "dark"] as const) {
  test(`keeps the Event journey readable in ${appearance} appearance`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({
      colorScheme: appearance,
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/sign-in");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    await page.getByLabel("Name", { exact: true }).fill("Event planner");
    await page
      .getByLabel("Email")
      .fill(`appearance-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await exerciseAppearance(page, testInfo, appearance);
    expect(errors).toEqual([]);
  });
}

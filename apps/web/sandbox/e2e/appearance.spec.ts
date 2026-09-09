import { expect, test } from "@playwright/test";
import { exerciseAppearance } from "../../e2e/helpers/appearance";
import { exerciseDisplaySettings } from "../../e2e/helpers/display-settings";

const sandboxUrl = new URL(
  "../../../../.chronelle/sandbox/chronelle.html",
  import.meta.url,
).href;

test("customizes all palettes and display settings offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await exerciseDisplaySettings(page, testInfo);
});

for (const appearance of ["light", "dark"] as const) {
  test(`supports the offline Event journey in ${appearance} appearance`, async ({
    page,
    context,
  }, testInfo) => {
    await context.setOffline(true);
    await page.emulateMedia({
      colorScheme: appearance,
      reducedMotion: "reduce",
    });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await page.goto(sandboxUrl);
    await exerciseAppearance(page, testInfo, appearance);
    await page.getByLabel("Preview role").selectOption("viewer");
    await expect(
      page.getByRole("button", { name: "Browse event data" }),
    ).toBeVisible();
    expect(requests).toEqual([]);
  });
}
